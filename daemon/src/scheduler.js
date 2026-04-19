'use strict';

const { validateTransition, isCompileSafe, mutatesScene } = require('./command');
const log = require('./log').create('scheduler');

const SCHEDULER_INTERVAL_MS = 200;
const HEARTBEAT_TIMEOUT_MS = 10000;
/**
 * How long a command may sit in `running` before the scheduler gives up on it.
 * Unity reports results back via /api/unity/result; if Unity domain-reloads or
 * crashes mid-command, the report never arrives and the command would block
 * the serialized dispatch queue indefinitely. 60s is a safe ceiling — longest
 * legitimate commands (folder-wide prefab scans) finish well under that in
 * practice. Override per-command by setting `requirements.maxRunningMs`.
 */
const DEFAULT_RUNNING_TIMEOUT_MS = 60000;

/**
 * Scheduler that evaluates queued/waiting commands and dispatches them to Unity
 * when their requirements are satisfied.
 */
class Scheduler {
  /**
   * @param {import('./queue')} queue
   * @param {import('./unity-state')} unityState
   */
  constructor(queue, unityState) {
    this.queue = queue;
    this.unityState = unityState;
    this._timer = null;

    // ── Observability counters ──
    // Updated every tick / dispatch so callers can verify the loop is live and
    // making progress. Surfaced via getMetrics() → /api/status.
    this._startedAt = Date.now();
    this.lastTickAt = null;
    this.tickCount = 0;
    this.lastDispatchAt = null;
    this.lastDispatchId = null;
    this.lastDispatchKind = null;
    /** Running counter of commands dispatched since daemon start. */
    this.totalDispatched = 0;
  }

  /** Start the scheduling loop. */
  start() {
    if (this._timer) return;
    this._timer = setInterval(() => this.tick(), SCHEDULER_INTERVAL_MS);
  }

  /** Stop the scheduling loop. */
  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  /**
   * Run a single scheduling pass. Called on interval and also triggered
   * by events (compilation finished, command completed, etc).
   */
  tick() {
    this.lastTickAt = Date.now();
    this.tickCount++;

    this.unityState.checkConnection(HEARTBEAT_TIMEOUT_MS);

    const unityConnected = this.unityState.connected;

    // ── Stuck-running timeout sweep ─────────────────────────────────────
    // Any command that's been `running` past its timeout is assumed lost
    // (typically: Unity domain-reloaded or crashed mid-command, so the
    // result report never came back). Mark it failed with a diagnostic so
    // the serialized dispatch queue can proceed and the user sees why.
    this._sweepStuckRunning();

    // Check if anything is currently dispatched or running — sequential execution
    const activeCommands = this.queue.list().filter(
      c => c.state === 'dispatched' || c.state === 'running'
    );
    const hasActive = activeCommands.length > 0;

    // Gather candidates: queued or waiting commands
    const candidates = this.queue.list().filter(
      c => c.state === 'queued' || c.state === 'waiting'
    );

    for (const cmd of candidates) {
      // ── Dependency check ──────────────────────────────────────────────
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

      // ── Unity connectivity ────────────────────────────────────────────
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

      // ── Global compilation gate ───────────────────────────────────────
      // Unity's CommandDispatcher rejects any non-compile-safe kind with
      // "Cannot execute this command while Unity is compiling". Hold such
      // commands in `waiting` until compilation finishes instead of letting
      // them fail terminally. The fresh-daemon-race gate (Waiting for
      // initial Unity state) applies to the same set — without the first
      // state report, we don't know whether Unity is compiling.
      if (!isCompileSafe(cmd.kind)) {
        if (!this.unityState.hasReceivedState) {
          // Connected (heartbeats arriving) but no state payload yet. Since
          // every heartbeat from an up-to-date bridge now carries compiling
          // state, this path only fires briefly on first connect or when an
          // old bridge version is loaded.
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

      // ── Compile-errors gate (only for kinds with requirements.compilation) ─
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

      // ── Play Mode scene-edit gate ─────────────────────────────────────
      // Scene mutations made during Play Mode look successful but revert
      // silently when Play Mode exits (Unity's design — only EditMode
      // edits persist). Holding such commands in `waiting` rather than
      // letting them run-and-vanish matches the "no silent data loss"
      // principle. Override with `options.allowPlayMode: true` on submit
      // for the rare legitimate runtime-scene-mutation case.
      if (this.unityState.playMode
          && mutatesScene(cmd.kind, cmd.args)
          && !cmd.allowPlayMode) {
        this._tryTransition(cmd.id, 'waiting', {
          waitingReason: 'Play Mode active — scene edits would be lost on exit. Stop Play Mode in Unity (or submit with --allow-playmode to override).'
        });
        continue;
      }

      // ── Sequential dispatch gate ──────────────────────────────────────
      if (hasActive) {
        // Can't dispatch yet — something else is still active
        if (cmd.state !== 'waiting') {
          // Leave as queued (don't transition to waiting — it's just queued behind another)
        }
        continue;
      }

      // ── All clear — dispatch ──────────────────────────────────────────
      this._tryTransition(cmd.id, 'dispatched', { waitingReason: null });
      this.lastDispatchAt = Date.now();
      this.lastDispatchId = cmd.id;
      this.lastDispatchKind = cmd.kind;
      this.totalDispatched++;
      log.info(`Dispatched ${cmd.kind} (${cmd.id})${cmd.humanLabel ? ` — ${cmd.humanLabel}` : ''}`);
      // Only dispatch one per tick
      return;
    }
  }

  /**
   * Timeout `running` commands that Unity hasn't reported back on. Runs on
   * every tick; in practice the check is O(running commands), which is
   * capped at 1 by the serialized dispatch invariant.
   */
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

  /**
   * Expose scheduler liveness + progress metrics for /api/status.
   * Callers can detect a stuck loop (lastTickAt ages without tick count advancing)
   * or a queue that's not draining (lastDispatchAt stale while candidates exist).
   */
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

  /**
   * Attempt a state transition, logging and swallowing errors.
   * @param {string} id
   * @param {string} newState
   * @param {object} [extra]
   */
  _tryTransition(id, newState, extra = {}) {
    try {
      const cmd = this.queue.get(id);
      if (!cmd) return;
      if (cmd.state === newState && cmd.waitingReason === (extra.waitingReason || null)) {
        return; // No change needed
      }
      const check = validateTransition(cmd.state, newState);
      if (!check.valid) return; // Can't transition, skip silently
      this.queue.update(id, { state: newState, ...extra });
    } catch (err) {
      // Non-fatal — log and continue
      log.error(`Transition error for ${id}: ${err.message}`);
    }
  }
}

module.exports = Scheduler;
