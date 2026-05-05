'use strict';

const { withAge, humanizeDuration } = require('../time-util');

/** States still in-flight — surfaced as queue.active for diagnosis. */
const NON_TERMINAL_STATES = new Set(['queued', 'waiting', 'dispatched', 'running']);
const MAX_ACTIVE_REPORTED = 25;

function createStatusHandlers(queue, unityState, assetWatcher, scheduler) {
  return {
    async status() {
      const now = Date.now();
      const nowIso = new Date(now).toISOString();
      const unityJson = unityState.toJSON();
      const assetsJson = assetWatcher ? assetWatcher.toJSON() : null;
      const schedulerMetrics = scheduler ? scheduler.getMetrics() : null;

      const unityAnnotated = {
        ...unityJson,
        lastHeartbeatAge: withAge(unityJson.lastHeartbeat, now),
        lastCompileSuccessAge: withAge(unityJson.lastCompileSuccess, now),
      };

      const assetsAnnotated = assetsJson
        ? { ...assetsJson, lastChangeAge: withAge(assetsJson.lastChange, now) }
        : null;

      const schedulerAnnotated = schedulerMetrics
        ? {
            ...schedulerMetrics,
            startedAtAge: withAge(schedulerMetrics.startedAt, now),
            lastTickAge: withAge(schedulerMetrics.lastTickAt, now),
            lastDispatchAge: withAge(schedulerMetrics.lastDispatchAt, now),
          }
        : null;

      // Sort active by time-in-state desc — most-stuck commands surface first.
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
     * GET /api/compile-status — synthesizes a `status` enum + `ready` bool from
     * raw Unity state. Raw `errors: []` is ambiguous (clean / never-seen / cleared
     * at cycle start); the enum disambiguates, in priority order:
     *   disconnected  no bridge
     *   unknown       connected, no state yet
     *   compiling     in progress
     *   errors        finished with errors
     *   stale         asset changed AFTER last clean compile — `errors: []` is pre-edit
     *   idle          clean + connected but no compile observed this daemon session
     *                 (fresh daemon, no script changes); ready=true but a fresh write
     *                 still wants refresh-assets + focus-unity before trusting it
     *   ok            last observed compile clean, no edits since
     */
    async compileStatus() {
      const now = Date.now();
      const compiling = unityState.compiling;
      const errors = unityState.getCompileErrors();
      const lastSuccess = unityState.lastCompileSuccess;
      const connected = unityState.connected;
      const hasReceivedState = unityState.hasReceivedState;
      const hasEverCompiled = lastSuccess !== null;

      // dirty-flag gate is load-bearing: a no-op write (identical content / already
      // imported) triggers fs.watch but no compile, so lastAssetChange > lastSuccess
      // would stick forever. refresh_assets calls markClean() on Unity confirmation.
      // Asset watcher covers Assets/ only — Packages/ (Dreamer dev) won't trip this.
      const watcherDirty = assetWatcher ? assetWatcher.isDirty() : false;
      const lastAssetChange = assetWatcher ? assetWatcher.lastChange : null;
      const lastChangedFile = assetWatcher ? assetWatcher.lastChangedFile : null;
      const lastSuccessMs = lastSuccess ? Date.parse(lastSuccess) : 0;
      const assetsDirtySinceCompile =
        watcherDirty &&
        lastAssetChange != null &&
        lastSuccessMs > 0 &&
        lastAssetChange > lastSuccessMs;

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
        summary = `Last observed clean compile: ${lastSuccess}${fmtAgo(lastSuccessAge.ageHuman)}.`;
      }

      return {
        status: 200,
        body: {
          status,
          ready,
          summary,
          now: new Date(now).toISOString(),
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
     * GET /api/activity — recent commands newest-first, for multi-agent audit.
     * Query: ?limit=N (default 20), ?since=MS, ?state=X.
     */
    async activity(query) {
      const now = Date.now();
      const limit = Math.max(1, Math.min(200, parseInt(query.limit, 10) || 20));
      const sinceMs = parseInt(query.since, 10);
      const stateFilter = query.state || null;

      let all = queue.list();
      if (stateFilter) all = all.filter((c) => c.state === stateFilter);
      if (Number.isFinite(sinceMs) && sinceMs > 0) {
        const cutoff = now - sinceMs;
        all = all.filter((c) => {
          const t = c.createdAt ? Date.parse(c.createdAt) : 0;
          return t >= cutoff;
        });
      }

      // Override queue.list()'s default priority/oldest sort — newest first here.
      all.sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));

      const entries = all.slice(0, limit).map((c) => {
        const created = c.createdAt ? Date.parse(c.createdAt) : null;
        const updated = c.updatedAt ? Date.parse(c.updatedAt) : null;
        const dispatched = c.dispatchedAt ? Date.parse(c.dispatchedAt) : null;
        const terminal = c.state === 'succeeded' || c.state === 'failed'
          || c.state === 'cancelled' || c.state === 'blocked';
        const durationMs = terminal && dispatched && updated
          ? Math.max(0, updated - dispatched)
          : null;

        return {
          id: c.id,
          kind: c.kind,
          label: c.humanLabel || null,
          state: c.state,
          error: c.error || null,
          waitingReason: c.waitingReason || null,
          createdAt: c.createdAt || null,
          createdAge: withAge(c.createdAt, now),
          endedAt: terminal ? c.updatedAt : null,
          endedAge: terminal ? withAge(c.updatedAt, now) : null,
          durationMs,
          durationHuman: humanizeDuration(durationMs),
        };
      });

      return {
        status: 200,
        body: {
          now: new Date(now).toISOString(),
          totalReturned: entries.length,
          limit,
          entries,
        },
      };
    },

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
