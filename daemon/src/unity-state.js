'use strict';

const log = require('./log').create('unity-state');
const MAX_CONSOLE_ENTRIES = 200;

/**
 * Tracks the current state of the Unity Editor as reported via heartbeats
 * and state updates.
 */
class UnityState {
  constructor() {
    this.connected = false;
    this.lastHeartbeat = null;
    this.compiling = false;
    this.compileErrors = [];
    this.playMode = false;
    this.lastCompileSuccess = null;
    /** @type {Array<{type:string, message:string, stackTrace?:string, timestamp:string}>} */
    this.consoleEntries = [];
  }

  /**
   * Merge partial state reported by Unity.
   * @param {object} state
   * @returns {{ compilationJustSucceeded: boolean }}
   */
  update(state) {
    const wasCompiling = this.compiling;

    if (state.compiling !== undefined) this.compiling = !!state.compiling;
    if (state.compileErrors !== undefined) this.compileErrors = Array.isArray(state.compileErrors) ? state.compileErrors : [];
    if (state.playMode !== undefined) this.playMode = !!state.playMode;

    this.connected = true;
    this.lastHeartbeat = Date.now();

    const compilationJustSucceeded =
      wasCompiling && !this.compiling && this.compileErrors.length === 0;

    if (compilationJustSucceeded) {
      this.lastCompileSuccess = new Date().toISOString();
    }

    return { compilationJustSucceeded };
  }

  /**
   * Record a heartbeat from Unity.
   */
  heartbeat() {
    this.connected = true;
    this.lastHeartbeat = Date.now();
  }

  /**
   * Check heartbeat freshness. Call periodically.
   * @param {number} [timeoutMs=10000]
   */
  checkConnection(timeoutMs = 10000) {
    if (!this.lastHeartbeat) {
      this.connected = false;
      return;
    }
    const elapsed = Date.now() - this.lastHeartbeat;
    if (elapsed > timeoutMs) {
      this.connected = false;
    }
    // If disconnected for >30s, reset compiling state — stale data is worse than unknown
    if (elapsed > 30000 && this.compiling) {
      this.compiling = false;
      log.info('Resetting stale compiling state after prolonged disconnect');
    }
  }

  /** @returns {boolean} */
  isReady() {
    return this.connected && !this.compiling;
  }

  /** @returns {boolean} */
  isCompiling() {
    return this.compiling;
  }

  /** @returns {string[]} */
  getCompileErrors() {
    return this.compileErrors;
  }

  /**
   * Append console entries (ring buffer, max 200).
   * @param {Array<{type:string, message:string, stackTrace?:string, timestamp?:string}>} entries
   */
  addConsoleEntries(entries) {
    if (!Array.isArray(entries)) return;
    for (const entry of entries) {
      this.consoleEntries.push({
        type: entry.type || 'Log',
        message: entry.message || '',
        stackTrace: entry.stackTrace || null,
        timestamp: entry.timestamp || new Date().toISOString(),
      });
    }
    // Trim to max
    if (this.consoleEntries.length > MAX_CONSOLE_ENTRIES) {
      this.consoleEntries = this.consoleEntries.slice(-MAX_CONSOLE_ENTRIES);
    }
  }

  /**
   * @param {number} [count=50]
   * @returns {Array}
   */
  getConsole(count = 50) {
    const n = Math.max(1, Math.min(count, this.consoleEntries.length));
    return this.consoleEntries.slice(-n);
  }

  /**
   * Serialisable snapshot.
   */
  toJSON() {
    return {
      connected: this.connected,
      lastHeartbeat: this.lastHeartbeat,
      compiling: this.compiling,
      compileErrors: this.compileErrors,
      playMode: this.playMode,
      lastCompileSuccess: this.lastCompileSuccess,
    };
  }
}

module.exports = UnityState;
