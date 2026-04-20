'use strict';

const log = require('../log').create('unity');
const registry = require('../project-registry');

/** Case/slash-insensitive path equality — reuses the registry's normaliser. */
function _pathsMatch(a, b) {
  if (!a || !b) return false;
  const na = registry.normalizeProjectPath(a);
  const nb = registry.normalizeProjectPath(b);
  return na != null && nb != null && na === nb;
}

/**
 * If the caller reports a `projectPath` that doesn't match the daemon's project,
 * this daemon is NOT the one that should be answering. Return a 409 so the
 * bridge can fail loudly instead of accidentally taking commands meant for
 * another project's daemon.
 *
 * The bridge uses the hint to look up the correct port from the registry and
 * reattach there.
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
 * Build handlers for /api/unity routes (Unity editor polling).
 * @param {import('../queue')} queue
 * @param {import('../unity-state')} unityState
 * @param {import('../scheduler')} scheduler
 * @returns {object} Route handler map
 */
/**
 * Auto-clear the asset watcher's `dirty` flag when Unity's last clean compile
 * happened AFTER the last observed asset change. Covers the path where Unity's
 * own Auto Refresh imports+compiles a direct-write edit (no daemon
 * refresh_assets in the loop) — without this, `dirty` stays stuck true forever,
 * every subsequent compile-gated command auto-prepends an unneeded refresh, and
 * `compile-status` can't exit the "stale" state.
 *
 * Called from both state and heartbeat paths because `lastCompileTime` updates
 * flow through either channel.
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
    /**
     * GET /api/unity/pending — Unity polls this for commands to execute.
     * Returns at most one dispatched command (sequential execution).
     */
    async pending() {
      const dispatched = queue.getPending();
      if (dispatched.length === 0) {
        return { status: 200, body: { commands: [] } };
      }
      // Return the highest-priority / oldest dispatched command
      const cmd = dispatched[0];
      // Mark it as running
      try {
        queue.update(cmd.id, { state: 'running' });
      } catch (err) {
        // If transition fails, still return it — it may already be running
        log.error(`Failed to mark ${cmd.id} as running: ${err.message}`);
      }
      return { status: 200, body: { commands: [cmd] } };
    },

    /**
     * POST /api/unity/result — Unity reports command completion.
     * Body: { id, success: bool, result?, error? }
     */
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
          // Unity sends result in 'resultJson' field — parse it or use as-is
          let result = body.result || body.resultJson || null;
          if (typeof result === 'string') {
            try { result = JSON.parse(result); } catch (_) { /* keep as string */ }
          }
          queue.update(body.id, {
            state: 'succeeded',
            result,
          });
          // A successful refresh means Unity has re-scanned the asset DB; any
          // .cs changes the file watcher flagged before this point have been
          // imported. Clear the dirty flag so we stop auto-prepending refreshes.
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

      // Trigger scheduler to evaluate dependent commands
      scheduler.tick();

      return { status: 200, body: queue.get(body.id) };
    },

    /**
     * POST /api/unity/state — Unity reports editor state.
     * Body: { compiling?, compileErrors?, playMode?, projectPath? }
     */
    async state(body) {
      if (!body || typeof body !== 'object') {
        return { status: 400, body: { error: 'Invalid state payload' } };
      }

      // Hard project-match enforcement: refuse state from a different project.
      // Without this, two Unity editors on the same port silently thrash
      // unityState.connectedProjectPath and steal each other's commands.
      if (body.projectPath && !_pathsMatch(body.projectPath, unityState.getDaemonProjectPath())) {
        return projectMismatchResponse(unityState, body.projectPath);
      }

      const { compilationJustSucceeded } = unityState.update(body);

      // Also handle console entries if bundled with state
      if (body.recentConsole) {
        unityState.addConsoleEntries(body.recentConsole);
      }

      // Auto-clear stale `dirty` if Unity's last clean compile is now newer
      // than the last asset change.
      _autoClearDirtyIfCompileCaughtUp(unityState, assetWatcher);

      // If compilation just finished successfully, kick the scheduler
      if (compilationJustSucceeded) {
        scheduler.tick();
      }

      return { status: 200, body: { ok: true } };
    },

    /**
     * POST /api/unity/heartbeat — Unity heartbeat.
     * Body can optionally include state fields.
     */
    async heartbeat(body) {
      // Hard project-match enforcement — reject before mutating state. Without
      // this, two Unity editors hitting the same port would clobber each
      // other's connected-project tracking.
      if (body && body.projectPath && !_pathsMatch(body.projectPath, unityState.getDaemonProjectPath())) {
        return projectMismatchResponse(unityState, body.projectPath);
      }

      if (body && typeof body === 'object') {
        // Accept state updates bundled with heartbeat
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

        // `lastCompileTime` may arrive via heartbeat too (bridge batches it
        // into whichever endpoint is next). Same auto-clear applies.
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
