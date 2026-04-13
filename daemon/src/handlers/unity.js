'use strict';

/**
 * Build handlers for /api/unity routes (Unity editor polling).
 * @param {import('../queue')} queue
 * @param {import('../unity-state')} unityState
 * @param {import('../scheduler')} scheduler
 * @returns {object} Route handler map
 */
function createUnityHandlers(queue, unityState, scheduler) {
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
        console.error(`[unity] Failed to mark ${cmd.id} as running: ${err.message}`);
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
     * Body: { compiling?, compileErrors?, playMode? }
     */
    async state(body) {
      if (!body || typeof body !== 'object') {
        return { status: 400, body: { error: 'Invalid state payload' } };
      }

      const { compilationJustSucceeded } = unityState.update(body);

      // Also handle console entries if bundled with state
      if (body.recentConsole) {
        unityState.addConsoleEntries(body.recentConsole);
      }

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
      if (body && typeof body === 'object') {
        // Accept state updates bundled with heartbeat
        const hasState = body.compiling !== undefined ||
                         body.compileErrors !== undefined ||
                         body.playMode !== undefined;
        if (hasState) {
          unityState.update(body);
        } else {
          unityState.heartbeat();
        }

        if (body.recentConsole) {
          unityState.addConsoleEntries(body.recentConsole);
        }
      } else {
        unityState.heartbeat();
      }

      return { status: 200, body: { ok: true } };
    },
  };
}

module.exports = createUnityHandlers;
