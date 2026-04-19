'use strict';

const { createCommand, isKnownKind } = require('../command');
const schemas = require('../schemas');
const { validate } = require('../validate');

// Commands resolved daemon-side from cached Unity state (never dispatched to Unity)
const DAEMON_SIDE_KINDS = new Set(['compile_status', 'console']);

/**
 * Build handlers for /api/commands routes.
 * @param {import('../queue')} queue
 * @param {import('../scheduler')} scheduler
 * @param {import('../unity-state')} unityState
 * @returns {object} Route handler map
 */
function createCommandHandlers(queue, scheduler, unityState, assetWatcher) {
  return {
    /**
     * POST /api/commands — Submit a new command.
     * Body: { kind, args, options? }
     */
    async submit(body) {
      if (!body || !body.kind) {
        return { status: 400, body: { error: 'Missing required field: kind' } };
      }

      if (!isKnownKind(body.kind)) {
        return {
          status: 400,
          body: { error: `Unknown command kind: '${body.kind}'` },
        };
      }

      // Schema validation (opt-in — only kinds with a schema file are checked).
      // Migrating incrementally means no-schema kinds still flow through as before.
      const schema = schemas.get(body.kind);
      if (schema) {
        const result = validate(schema, body.args || {});
        if (!result.valid) {
          return {
            status: 400,
            body: {
              error: `Invalid args for '${body.kind}'`,
              details: result.errors,
              kind: body.kind,
              schema: schema.args || {},
            },
          };
        }
      }

      // Daemon-side instant commands — resolve from cached Unity state
      if (DAEMON_SIDE_KINDS.has(body.kind)) {
        return resolveDaemonSide(body.kind, body.args || {}, unityState);
      }

      // Auto-enrich refresh_assets with the list of .cs files the watcher saw
      // change since the last refresh. The bridge uses this list to heal files
      // that Unity misclassified as DefaultImporter (unknown asset type) when
      // they were written while the Editor was unfocused. See AssetOps.cs.
      const args = body.args || {};
      if (body.kind === 'refresh_assets' && assetWatcher && !args.changedFiles) {
        const changed = assetWatcher.getChangedFiles();
        if (changed.length > 0) args.changedFiles = changed;
      }

      try {
        const cmd = createCommand(body.kind, args, body.options || {});
        queue.add(cmd);
        // Kick the scheduler immediately so it can evaluate the new command
        scheduler.tick();
        return { status: 201, body: cmd };
      } catch (err) {
        return { status: 400, body: { error: err.message } };
      }
    },

    /**
     * GET /api/commands — List commands with optional filters.
     * Query: ?state=X&originTaskId=X&limit=N
     */
    async list(query) {
      const filters = {};
      if (query.state) filters.state = query.state;
      if (query.originTaskId) filters.originTaskId = query.originTaskId;
      if (query.limit) filters.limit = parseInt(query.limit, 10) || 50;

      const commands = queue.list(filters);
      return { status: 200, body: { commands, count: commands.length } };
    },

    /**
     * GET /api/commands/:id — Get a specific command.
     */
    async get(id) {
      const cmd = queue.get(id);
      if (!cmd) {
        return { status: 404, body: { error: `Command not found: ${id}` } };
      }
      return { status: 200, body: cmd };
    },

    /**
     * DELETE /api/commands/:id — Cancel a command.
     */
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

/**
 * Resolve a daemon-side command instantly from cached Unity state.
 */
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
