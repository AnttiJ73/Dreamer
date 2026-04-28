'use strict';

const { createCommand, isKnownKind } = require('../command');
const schemas = require('../schemas');
const { validate } = require('../validate');

// Commands resolved daemon-side from cached Unity state — never dispatched to Unity.
const DAEMON_SIDE_KINDS = new Set(['compile_status', 'console']);

function createCommandHandlers(queue, scheduler, unityState, assetWatcher) {
  return {
    /** POST /api/commands — body: { kind, args, options? }. */
    async submit(body) {
      if (!body || !body.kind) {
        return { status: 400, body: { error: 'Missing required field: kind' } };
      }

      if (!isKnownKind(body.kind)) {
        // Most common cause: kind added to command.js but daemon still running
        // with stale in-memory definitions. Hint is verbose by design — debugging
        // without it took hours.
        return {
          status: 400,
          body: {
            error: `Unknown command kind: '${body.kind}'`,
            source: 'daemon',
            hint:
              "Rejected by the daemon (kind not in KIND_DEFS). " +
              "If you just added this kind to daemon/src/command.js, restart the daemon: " +
              "kill the PID in daemon/.dreamer-daemon.pid and re-run any `./bin/dreamer` command. " +
              "If the kind is from an add-on, that add-on must register the same kind in its " +
              "Registration.cs AND core daemon must list it in KIND_DEFS.",
          },
        };
      }

      // Opt-in schema validation — kinds without a schema flow through unvalidated (incremental migration).
      const schema = schemas.get(body.kind);
      if (schema) {
        const result = validate(schema, body.args || {});
        if (!result.valid) {
          return {
            status: 400,
            body: {
              error: `Invalid args for '${body.kind}'`,
              source: 'daemon',
              hint: 'Rejected by the daemon schema validator. See `details` for per-arg errors and `schema` for the expected shape.',
              details: result.errors,
              kind: body.kind,
              schema: schema.args || {},
            },
          };
        }
      }

      if (DAEMON_SIDE_KINDS.has(body.kind)) {
        return resolveDaemonSide(body.kind, body.args || {}, unityState);
      }

      // Hand the watcher's changed-files list to refresh_assets so the bridge
      // can heal .cs files Unity misclassified as DefaultImporter (when written
      // while the Editor was unfocused). See AssetOps.cs.
      const args = body.args || {};
      if (body.kind === 'refresh_assets' && assetWatcher && !args.changedFiles) {
        const changed = assetWatcher.getChangedFiles();
        if (changed.length > 0) args.changedFiles = changed;
      }

      try {
        const cmd = createCommand(body.kind, args, body.options || {});
        queue.add(cmd);
        scheduler.tick();
        return { status: 201, body: cmd };
      } catch (err) {
        return { status: 400, body: { error: err.message } };
      }
    },

    /** GET /api/commands — query: ?state=X&originTaskId=X&limit=N. */
    async list(query) {
      const filters = {};
      if (query.state) filters.state = query.state;
      if (query.originTaskId) filters.originTaskId = query.originTaskId;
      if (query.limit) filters.limit = parseInt(query.limit, 10) || 50;

      const commands = queue.list(filters);
      return { status: 200, body: { commands, count: commands.length } };
    },

    async get(id) {
      const cmd = queue.get(id);
      if (!cmd) {
        return { status: 404, body: { error: `Command not found: ${id}` } };
      }
      return { status: 200, body: cmd };
    },

    async cancel(id) {
      try {
        const cmd = queue.cancel(id);
        return { status: 200, body: cmd };
      } catch (err) {
        if (err.message.includes('not found')) {
          return { status: 404, body: { error: err.message } };
        }
        return { status: 400, body: { error: err.message } };
      }
    },
  };
}

function resolveDaemonSide(kind, args, unityState) {
  const now = new Date().toISOString();
  if (kind === 'compile_status') {
    return {
      status: 200,
      body: {
        id: null,
        kind,
        state: 'succeeded',
        result: {
          compiling: unityState.compiling,
          errors: unityState.getCompileErrors(),
          lastSuccess: unityState.lastCompileSuccess,
          connected: unityState.connected,
        },
        completedAt: now,
      },
    };
  }
  if (kind === 'console') {
    const count = (args && args.count) || 50;
    return {
      status: 200,
      body: {
        id: null,
        kind,
        state: 'succeeded',
        result: {
          entries: unityState.getConsole(count),
          total: unityState.consoleEntries.length,
        },
        completedAt: now,
      },
    };
  }
  return { status: 400, body: { error: `Unhandled daemon-side kind: ${kind}` } };
}

module.exports = createCommandHandlers;
