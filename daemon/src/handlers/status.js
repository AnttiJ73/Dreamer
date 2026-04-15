'use strict';

/**
 * Build handlers for status / informational routes.
 * @param {import('../queue')} queue
 * @param {import('../unity-state')} unityState
 * @returns {object}
 */
function createStatusHandlers(queue, unityState) {
  return {
    /**
     * GET /api/status — Overall daemon + Unity status.
     */
    async status() {
      return {
        status: 200,
        body: {
          daemon: {
            uptime: process.uptime(),
            pid: process.pid,
            version: '0.1.0',
            projectPath: unityState.getDaemonProjectPath(),
          },
          unity: unityState.toJSON(),
          queue: queue.getStats(),
        },
      };
    },

    /**
     * GET /api/compile-status — Compilation-specific status.
     */
    async compileStatus() {
      return {
        status: 200,
        body: {
          compiling: unityState.compiling,
          errors: unityState.getCompileErrors(),
          lastSuccess: unityState.lastCompileSuccess,
          connected: unityState.connected,
        },
      };
    },

    /**
     * GET /api/console — Recent console entries.
     * Query: ?count=N
     */
    async console(query) {
      const count = parseInt(query.count, 10) || 50;
      return {
        status: 200,
        body: {
          entries: unityState.getConsole(count),
          total: unityState.consoleEntries.length,
        },
      };
    },
  };
}

module.exports = createStatusHandlers;
