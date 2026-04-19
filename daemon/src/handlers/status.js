'use strict';

const { withAge, humanizeDuration } = require('../time-util');

/** States that are still "in flight" — surfaced as queue.active for diagnosis. */
const NON_TERMINAL_STATES = new Set(['queued', 'waiting', 'dispatched', 'running']);
const MAX_ACTIVE_REPORTED = 25;

/**
 * Build handlers for status / informational routes.
 * @param {import('../queue')} queue
 * @param {import('../unity-state')} unityState
 * @param {import('../asset-watcher')} [assetWatcher]
 * @param {import('../scheduler')} [scheduler]
 * @returns {object}
 */
function createStatusHandlers(queue, unityState, assetWatcher, scheduler) {
  return {
    /**
     * GET /api/status — Overall daemon + Unity status.
     *
     * Every timestamp comes with `{ at, ageMs, ageSec, ageHuman }` so the caller
     * can see "3m ago" without subtracting from a wall clock. `queue.active`
     * lists non-terminal commands with their time-in-state — the primary signal
     * for "is Dreamer actually making progress on the queue".
     */
    async status() {
      const now = Date.now();
      const nowIso = new Date(now).toISOString();
      const unityJson = unityState.toJSON();
      const assetsJson = assetWatcher ? assetWatcher.toJSON() : null;
      const schedulerMetrics = scheduler ? scheduler.getMetrics() : null;

      // Annotate Unity timestamps with age.
      const unityAnnotated = {
        ...unityJson,
        lastHeartbeatAge: withAge(unityJson.lastHeartbeat, now),
        lastCompileSuccessAge: withAge(unityJson.lastCompileSuccess, now),
      };

      // Annotate asset-watcher timestamp with age.
      const assetsAnnotated = assetsJson
        ? { ...assetsJson, lastChangeAge: withAge(assetsJson.lastChange, now) }
        : null;

      // Annotate scheduler metrics with ages.
      const schedulerAnnotated = schedulerMetrics
        ? {
            ...schedulerMetrics,
            startedAtAge: withAge(schedulerMetrics.startedAt, now),
            lastTickAge: withAge(schedulerMetrics.lastTickAt, now),
            lastDispatchAge: withAge(schedulerMetrics.lastDispatchAt, now),
          }
        : null;

      // Per-command "active" view — the primary diagnostic for queue health.
      // Sorted by time-in-state descending so the most-stuck commands surface first.
      const allCommands = queue.list();
      const activeSource = allCommands
        .filter((c) => NON_TERMINAL_STATES.has(c.state))
        .map((c) => {
          const updatedMs = c.updatedAt ? Date.parse(c.updatedAt) : null;
          const createdMs = c.createdAt ? Date.parse(c.createdAt) : null;
          const sinceUpdateMs = updatedMs ? Math.max(0, now - updatedMs) : null;
          const sinceCreateMs = createdMs ? Math.max(0, now - createdMs) : null;
          return {
            id: c.id,
            kind: c.kind,
            state: c.state,
            waitingReason: c.waitingReason || null,
            humanLabel: c.humanLabel || null,
            attemptCount: c.attemptCount || 0,
            priority: c.priority || 0,
            dependsOn: c.dependsOn || null,
            createdAt: c.createdAt || null,
            updatedAt: c.updatedAt || null,
            sinceUpdateMs,
            sinceUpdateHuman: humanizeDuration(sinceUpdateMs),
            sinceCreateMs,
            sinceCreateHuman: humanizeDuration(sinceCreateMs),
          };
        })
        .sort((a, b) => (b.sinceUpdateMs || 0) - (a.sinceUpdateMs || 0));

      const activeTruncated = activeSource.slice(0, MAX_ACTIVE_REPORTED);

      return {
        status: 200,
        body: {
          now: nowIso,
          daemon: {
            uptime: process.uptime(),
            uptimeHuman: humanizeDuration(process.uptime() * 1000),
            pid: process.pid,
            version: '0.1.0',
            projectPath: unityState.getDaemonProjectPath(),
          },
          unity: unityAnnotated,
          scheduler: schedulerAnnotated,
          queue: {
            ...queue.getStats(),
            activeCount: activeSource.length,
            activeTruncatedTo: activeTruncated.length,
            active: activeTruncated,
          },
          assets: assetsAnnotated,
        },
      };
    },

    /**
     * GET /api/compile-status — Compilation-specific status.
     *
     * Raw Unity state is ambiguous on its own: `errors: []` can mean "last compile
     * passed cleanly", "no compile has been observed this daemon session", OR "errors
     * were cleared at the start of a compile cycle". This handler synthesizes a single
     * `status` enum and a `ready` boolean so callers don't have to AND fields together
     * and get it wrong.
     *
     * `status` values (in priority order):
     *   disconnected — Unity bridge not connected.
     *   unknown      — Connected but no state report received yet.
     *   compiling    — Compile cycle in progress.
     *   errors       — Compile finished with errors.
     *   stale        — A watched asset changed AFTER the last observed clean compile;
     *                  "errors: []" reflects the pre-edit state and must not be trusted.
     *   idle         — Clean + connected, but no compile cycle has been observed this
     *                  daemon session (e.g. fresh daemon with no script changes yet).
     *                  `ready` is still true, but callers that just wrote a script
     *                  should trigger a compile (refresh-assets + focus-unity) before
     *                  relying on the empty errors array.
     *   ok           — Last observed compile was clean; no edits since.
     *
     * `ready` is the gate used by the scheduler for compile-sensitive commands.
     */
    async compileStatus() {
      const now = Date.now();
      const compiling = unityState.compiling;
      const errors = unityState.getCompileErrors();
      const lastSuccess = unityState.lastCompileSuccess;
      const connected = unityState.connected;
      const hasReceivedState = unityState.hasReceivedState;
      const hasEverCompiled = lastSuccess !== null;

      // Cross-check: have watched assets changed since the last observed clean compile?
      // Only meaningful when both timestamps exist. Note: the asset watcher watches
      // Assets/ only, not Packages/ — Dreamer package development edits won't trip this.
      const lastAssetChange = assetWatcher ? assetWatcher.lastChange : null;
      const lastChangedFile = assetWatcher ? assetWatcher.lastChangedFile : null;
      const lastSuccessMs = lastSuccess ? Date.parse(lastSuccess) : 0;
      const assetsDirtySinceCompile =
        lastAssetChange != null && lastSuccessMs > 0 && lastAssetChange > lastSuccessMs;

      // Pre-compute ages so summary strings can show "X ago" next to raw timestamps.
      // Readers scan "2m 14s ago" far faster than subtracting an ISO string from `now`.
      const lastSuccessAge = withAge(lastSuccess, now);
      const lastAssetChangeAge = withAge(lastAssetChange, now);
      const fmtAgo = (ageHuman) => (ageHuman ? ` (${ageHuman})` : '');

      let status, ready, summary;

      if (!connected) {
        status = 'disconnected';
        ready = false;
        summary = 'Unity bridge is not connected. Start/focus Unity so the bridge can reattach.';
      } else if (!hasReceivedState) {
        status = 'unknown';
        ready = false;
        summary = 'Connected to Unity, but no state report received yet — wait a moment and retry.';
      } else if (compiling) {
        status = 'compiling';
        ready = false;
        summary = 'Unity is compiling.';
      } else if (errors.length > 0) {
        status = 'errors';
        ready = false;
        const shown = errors.slice(0, 3).map((e) => String(e).replace(/\s+/g, ' ').slice(0, 200));
        const more = errors.length > 3 ? ` (+${errors.length - 3} more)` : '';
        summary =
          `${errors.length} compile error${errors.length === 1 ? '' : 's'}: ` +
          `${shown.join(' | ')}${more}`;
      } else if (assetsDirtySinceCompile) {
        status = 'stale';
        ready = false;
        const changedAt = new Date(lastAssetChange).toISOString();
        summary =
          `Assets changed at ${changedAt}${fmtAgo(lastAssetChangeAge.ageHuman)} ` +
          `(${lastChangedFile || 'unknown file'}) after the last observed clean compile at ` +
          `${lastSuccess}${fmtAgo(lastSuccessAge.ageHuman)}. "errors: []" is stale — run ` +
          '`./bin/dreamer refresh-assets --wait` (and `focus-unity` on Windows) to trigger ' +
          'a compile before trusting this as a pass.';
      } else if (!hasEverCompiled) {
        status = 'idle';
        ready = true;
        summary =
          'Connected and no errors cached, but no compile cycle has been observed this ' +
          'daemon session — "errors: []" only reflects an empty cache, not a verified pass. ' +
          'If you just wrote a .cs file, run `./bin/dreamer refresh-assets --wait` (plus ' +
          '`focus-unity` on Windows) before trusting this as clean.';
      } else {
        status = 'ok';
        ready = true;
        const source = unityState.lastCompileSourceIsBridge
          ? `Unity reports last clean compile at ${lastSuccess}${fmtAgo(lastSuccessAge.ageHuman)} (restored from bridge memory after daemon restart — daemon didn't witness it directly).`
          : `Last observed clean compile: ${lastSuccess}${fmtAgo(lastSuccessAge.ageHuman)}.`;
        summary = source;
      }

      return {
        status: 200,
        body: {
          // ── Synthesized signals (prefer these) ──
          status,
          ready,
          summary,
          // ── Current time for easy client-side comparison ──
          now: new Date(now).toISOString(),
          // ── Raw fields (for inspection / backward compat) ──
          compiling,
          errors,
          lastSuccess,
          lastSuccessAge,
          hasEverCompiled,
          hasReceivedState,
          connected,
          assetsDirtySinceCompile,
          lastAssetChange: lastAssetChange ? new Date(lastAssetChange).toISOString() : null,
          lastAssetChangeAge,
          lastChangedFile,
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
