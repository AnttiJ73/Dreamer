'use strict';

const { validateTransition, isCompileSafe, mutatesScene } = require('./command');
const log = require('./log').create('scheduler');

const SCHEDULER_INTERVAL_MS = 200;
// 10s was too tight: with 3+ CLI clients contending for the daemon, plus
// Windows occasionally throttling Unity's background threads when the editor
// loses focus, transient blips (1-2 missed heartbeats) caused false disconnects
// even though the bridge was still sending. 25s = ~8 missed heartbeats at the
// 3s send interval before we conclude Unity is gone.
const HEARTBEAT_TIMEOUT_MS = 25000;
// Stuck-running ceiling: Unity reports results via /api/unity/result, but a
// domain-reload or crash mid-command means the report never arrives and the
// serialized dispatch queue would block forever. 60s clears legit slow commands
// (folder-wide prefab scans) — override per-command via requirements.maxRunningMs.
const DEFAULT_RUNNING_TIMEOUT_MS = 60000;

/** Evaluates queued/waiting commands and dispatches to Unity when ready. */
class Scheduler {
  constructor(queue, unityState) {
    this.queue = queue;
    this.unityState = unityState;
    this._timer = null;

    // Observability counters — surfaced via getMetrics() → /api/status so
    // callers can detect a frozen loop or non-draining queue.
    this._startedAt = Date.now();
    this.lastTickAt = null;
    this.tickCount = 0;
    this.lastDispatchAt = null;
    this.lastDispatchId = null;
    this.lastDispatchKind = null;
    this.totalDispatched = 0;
  }

  start() {
    if (this._timer) return;
    this._timer = setInterval(() => this.tick(), SCHEDULER_INTERVAL_MS);
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  /** One scheduling pass — invoked on interval and on lifecycle events. */
  tick() {
    this.lastTickAt = Date.now();
    this.tickCount++;

    this.unityState.checkConnection(HEARTBEAT_TIMEOUT_MS);

    const unityConnected = this.unityState.connected;

    this._sweepStuckRunning();

    const activeCommands = this.queue.list().filter(
      c => c.state === 'dispatched' || c.state === 'running'
    );
    const hasActive = activeCommands.length > 0;

    const candidates = this.queue.list().filter(
      c => c.state === 'queued' || c.state === 'waiting'
    );

    for (const cmd of candidates) {
      if (cmd.dependsOn) {
        const dep = this.queue.get(cmd.dependsOn);
        if (!dep) {
          this._tryTransition(cmd.id, 'blocked', { waitingReason: `Dependency ${cmd.dependsOn} not found` });
          continue;
        }
        if (dep.state === 'failed' || dep.state === 'blocked' || dep.state === 'cancelled') {
          this._tryTransition(cmd.id, 'blocked', { waitingReason: `Dependency ${cmd.dependsOn} is ${dep.state}` });
          continue;
        }
        if (dep.state !== 'succeeded') {
          this._tryTransition(cmd.id, 'waiting', { waitingReason: `Waiting for dependency ${cmd.dependsOn}` });
          continue;
        }
      }

      if (!unityConnected) {
        // Distinguish "bridge has never connected this daemon session" from
        // "bridge was connected and then went away". Different user remedies:
        // the first means open Unity / reimport the package / check the port;
        // the second means Unity lost focus, domain-reloaded, or crashed.
        const everConnected = this.unityState.lastHeartbeat != null;
        const reason = everConnected
          ? 'unity_disconnected (bridge was connected, last heartbeat older than timeout — Unity may have quit, domain-reloaded, or been unfocused long enough to stall)'
          : 'Unity bridge has not connected this daemon session. Open Unity on this project; if the editor is running, verify the projects-registry entry and that the bridge is enabled (Tools > Dreamer > Toggle Bridge).';
        this._tryTransition(cmd.id, 'waiting', { waitingReason: reason });
        continue;
      }

      // Global compile gate: non-compile-safe kinds wait for Unity to be idle
      // and to have reported state at least once. Unity rejects them mid-compile
      // with "Cannot execute this command while Unity is compiling" — holding
      // them in waiting beats letting them fail terminally.
      if (!isCompileSafe(cmd.kind)) {
        if (!this.unityState.hasReceivedState) {
          this._tryTransition(cmd.id, 'waiting', {
            waitingReason: 'Waiting for initial Unity state — bridge is connected but hasn\'t reported compile status yet. If this persists, the bridge assembly may be older than the daemon (reimport the package via Unity > Package Manager).'
          });
          continue;
        }
        if (this.unityState.isCompiling()) {
          this._tryTransition(cmd.id, 'waiting', { waitingReason: 'Waiting for compilation to finish' });
          continue;
        }
      }

      const reqs = cmd.requirements;
      if (reqs) {
        if (reqs.compilation) {
          if (this.unityState.getCompileErrors().length > 0) {
            this._tryTransition(cmd.id, 'waiting', { waitingReason: 'Compile errors present' });
            continue;
          }
        }
        if (reqs.playMode && !this.unityState.playMode) {
          this._tryTransition(cmd.id, 'waiting', { waitingReason: 'Waiting for Play Mode' });
          continue;
        }
      }

      // Play Mode scene-edit gate: only EditMode scene mutations persist —
      // Play Mode edits look successful and silently revert on exit. Override
      // with options.allowPlayMode for intentional runtime mutation.
      if (this.unityState.playMode
          && mutatesScene(cmd.kind, cmd.args)
          && !cmd.allowPlayMode) {
        this._tryTransition(cmd.id, 'waiting', {
          waitingReason: 'Play Mode active — scene edits would be lost on exit. Stop Play Mode in Unity (or submit with --allow-playmode to override).'
        });
        continue;
      }

      // Sequential dispatch — leave as queued (not waiting; it's just behind another).
      if (hasActive) continue;

      this._tryTransition(cmd.id, 'dispatched', { waitingReason: null });
      this.lastDispatchAt = Date.now();
      this.lastDispatchId = cmd.id;
      this.lastDispatchKind = cmd.kind;
      this.totalDispatched++;
      log.info(`Dispatched ${cmd.kind} (${cmd.id})${cmd.humanLabel ? ` — ${cmd.humanLabel}` : ''}`);
      return;
    }
  }

  _sweepStuckRunning() {
    const now = Date.now();
    const running = this.queue.list().filter(c => c.state === 'running');
    for (const cmd of running) {
      const timeoutMs = (cmd.requirements && cmd.requirements.maxRunningMs) || DEFAULT_RUNNING_TIMEOUT_MS;
      const dispatchedMs = cmd.dispatchedAt ? Date.parse(cmd.dispatchedAt) : Date.parse(cmd.updatedAt);
      if (!Number.isFinite(dispatchedMs)) continue;
      const age = now - dispatchedMs;
      if (age < timeoutMs) continue;
      const reason = `No result reported within ${Math.round(age / 1000)}s (timeout ${Math.round(timeoutMs / 1000)}s) — Unity likely domain-reloaded or crashed mid-command. Resubmit to retry.`;
      try {
        this.queue.update(cmd.id, { state: 'failed', error: reason });
        log.warn(`Timed out running ${cmd.kind} (${cmd.id}) after ${Math.round(age / 1000)}s`);
      } catch (err) {
        log.error(`Failed to time out ${cmd.id}: ${err.message}`);
      }
    }
  }

  getMetrics() {
    return {
      startedAt: this._startedAt,
      lastTickAt: this.lastTickAt,
      tickCount: this.tickCount,
      lastDispatchAt: this.lastDispatchAt,
      lastDispatchId: this.lastDispatchId,
      lastDispatchKind: this.lastDispatchKind,
      totalDispatched: this.totalDispatched,
      tickIntervalMs: SCHEDULER_INTERVAL_MS,
    };
  }

  _tryTransition(id, newState, extra = {}) {
    try {
      const cmd = this.queue.get(id);
      if (!cmd) return;
      if (cmd.state === newState && cmd.waitingReason === (extra.waitingReason || null)) return;
      const check = validateTransition(cmd.state, newState);
      if (!check.valid) return;
      this.queue.update(id, { state: newState, ...extra });
    } catch (err) {
      log.error(`Transition error for ${id}: ${err.message}`);
    }
  }
}

module.exports = Scheduler;
