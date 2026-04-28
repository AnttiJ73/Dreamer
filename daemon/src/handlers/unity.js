'use strict';

const log = require('../log').create('unity');
const registry = require('../project-registry');

function _pathsMatch(a, b) {
  if (!a || !b) return false;
  const na = registry.normalizeProjectPath(a);
  const nb = registry.normalizeProjectPath(b);
  return na != null && nb != null && na === nb;
}

/**
 * 409 when a different project hits this daemon — the bridge uses the hint to
 * look up the correct port from the registry and reattach. Without this, two
 * editors on the same port silently steal each other's commands.
 */
function projectMismatchResponse(unityState, reportedPath) {
  const expected = unityState.getDaemonProjectPath();
  const suggestedPort = reportedPath ? registry.getPortForProject(reportedPath) : null;
  return {
    status: 409,
    body: {
      error: 'wrong-project',
      message:
        `This daemon serves ${expected}, but the caller is ${reportedPath || '<unknown>'}. ` +
        (suggestedPort
          ? `The registry says port ${suggestedPort} is bound to that project — connect there instead.`
          : 'That project is not registered yet — run `./bin/dreamer status` from its root.'),
      expectedProjectPath: expected,
      reportedProjectPath: reportedPath || null,
      suggestedPort,
      registryPath: registry.getRegistryPath(),
    },
  };
}

/**
 * Clear the asset watcher's dirty flag when Unity's last clean compile is newer
 * than the last asset change. Without this, Unity's own Auto Refresh path (no
 * daemon refresh_assets) leaves dirty stuck true forever — every compile-gated
 * command auto-prepends an unneeded refresh and compile-status can't exit
 * "stale". Called from both state and heartbeat (lastCompileTime arrives via either).
 */
function _autoClearDirtyIfCompileCaughtUp(unityState, assetWatcher) {
  if (!assetWatcher || !assetWatcher.isDirty()) return;
  if (!unityState.lastCompileSuccess) return;
  const lastSuccessMs = Date.parse(unityState.lastCompileSuccess);
  const lastChangeMs = assetWatcher.lastChange || 0;
  if (Number.isFinite(lastSuccessMs) && lastSuccessMs > lastChangeMs) {
    assetWatcher.markClean();
  }
}

function createUnityHandlers(queue, unityState, scheduler, assetWatcher) {
  return {
    /** GET /api/unity/pending — returns at most one dispatched command (serialized). */
    async pending() {
      const dispatched = queue.getPending();
      if (dispatched.length === 0) {
        return { status: 200, body: { commands: [] } };
      }
      const cmd = dispatched[0];
      try {
        queue.update(cmd.id, { state: 'running' });
      } catch (err) {
        // Transition failed — still return; cmd may already be running.
        log.error(`Failed to mark ${cmd.id} as running: ${err.message}`);
      }
      return { status: 200, body: { commands: [cmd] } };
    },

    /** POST /api/unity/result — body: { id, success, result?, error? }. */
    async result(body) {
      if (!body || !body.id) {
        return { status: 400, body: { error: 'Missing required field: id' } };
      }

      const cmd = queue.get(body.id);
      if (!cmd) {
        return { status: 404, body: { error: `Command not found: ${body.id}` } };
      }

      try {
        if (body.success) {
          let result = body.result || body.resultJson || null;
          if (typeof result === 'string') {
            try { result = JSON.parse(result); } catch (_) { /* keep as string */ }
          }
          queue.update(body.id, {
            state: 'succeeded',
            result,
          });
          // Successful refresh = asset DB rescanned, watcher's flagged .cs are imported.
          if (cmd.kind === 'refresh_assets' && assetWatcher) {
            assetWatcher.markClean();
          }
        } else {
          queue.update(body.id, {
            state: 'failed',
            error: body.error || 'Unknown error',
          });
        }
      } catch (err) {
        return { status: 400, body: { error: err.message } };
      }

      scheduler.tick();

      return { status: 200, body: queue.get(body.id) };
    },

    /** POST /api/unity/state — body: { compiling?, compileErrors?, playMode?, projectPath? }. */
    async state(body) {
      if (!body || typeof body !== 'object') {
        return { status: 400, body: { error: 'Invalid state payload' } };
      }

      if (body.projectPath && !_pathsMatch(body.projectPath, unityState.getDaemonProjectPath())) {
        return projectMismatchResponse(unityState, body.projectPath);
      }

      const { compilationJustSucceeded } = unityState.update(body);

      if (body.recentConsole) {
        unityState.addConsoleEntries(body.recentConsole);
      }

      _autoClearDirtyIfCompileCaughtUp(unityState, assetWatcher);

      if (compilationJustSucceeded) {
        scheduler.tick();
      }

      return { status: 200, body: { ok: true } };
    },

    /** POST /api/unity/heartbeat — body may bundle state fields. */
    async heartbeat(body) {
      if (body && body.projectPath && !_pathsMatch(body.projectPath, unityState.getDaemonProjectPath())) {
        return projectMismatchResponse(unityState, body.projectPath);
      }

      if (body && typeof body === 'object') {
        const hasState = body.compiling !== undefined ||
                         body.compileErrors !== undefined ||
                         body.playMode !== undefined;
        if (hasState) {
          unityState.update(body);
        } else {
          unityState.heartbeat(body.projectPath);
        }

        if (body.recentConsole) {
          unityState.addConsoleEntries(body.recentConsole);
        }

        // lastCompileTime can arrive on heartbeat too — bridge batches into whichever endpoint is next.
        _autoClearDirtyIfCompileCaughtUp(unityState, assetWatcher);
      } else {
        unityState.heartbeat();
      }

      return {
        status: 200,
        body: {
          ok: true,
          projectMatch: true,
          expectedProjectPath: unityState.getDaemonProjectPath(),
        },
      };
    },
  };
}

module.exports = createUnityHandlers;
