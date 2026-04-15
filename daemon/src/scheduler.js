'use strict';

const { validateTransition, isCompileSafe } = require('./command');
const log = require('./log').create('scheduler');

const SCHEDULER_INTERVAL_MS = 200;
const HEARTBEAT_TIMEOUT_MS = 10000;

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
    this.unityState.checkConnection(HEARTBEAT_TIMEOUT_MS);

    const unityConnected = this.unityState.connected;

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
        this._tryTransition(cmd.id, 'waiting', { waitingReason: 'unity_disconnected' });
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
          this._tryTransition(cmd.id, 'waiting', { waitingReason: 'Waiting for initial Unity state' });
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
      // Only dispatch one per tick
      return;
    }
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
