'use strict';

const path = require('path');
const log = require('./log').create('unity-state');
const MAX_CONSOLE_ENTRIES = 200;

/**
 * Canonicalise a path for equality comparison across platforms.
 * - Converts backslashes to forward slashes.
 * - Lowercases on Windows (case-insensitive filesystem).
 * - Strips trailing slashes.
 */
function normalisePath(p) {
  if (!p || typeof p !== 'string') return null;
  let n = p.replace(/\\/g, '/').replace(/\/+$/, '');
  if (process.platform === 'win32') n = n.toLowerCase();
  return n;
}

/** The Unity project root this daemon belongs to — derived from its install location. */
const DAEMON_PROJECT_ROOT = path.resolve(__dirname, '..', '..');

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
    /** True once Unity has reported full state at least once. Compilation-gated
     *  commands must wait until this is true, otherwise a fresh daemon with an
     *  empty state snapshot will dispatch them before the first state tick and
     *  Unity will bounce them with "Type not found" if compile errors exist. */
    this.hasReceivedState = false;
    /** The project root of the Unity that's talking to us, as reported in heartbeats. */
    this.connectedProjectPath = null;
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
    if (state.projectPath && typeof state.projectPath === 'string') {
      this.connectedProjectPath = state.projectPath;
    }

    // Any non-heartbeat state update counts — at this point we know Unity
    // has told us about compiling/compileErrors/playMode, so compilation-
    // gated dispatch can proceed without the fresh-daemon race.
    if (state.compiling !== undefined || state.compileErrors !== undefined || state.playMode !== undefined) {
      this.hasReceivedState = true;
    }

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
   * Record a heartbeat from Unity. Optionally accepts the Unity-reported project path.
   * @param {string} [projectPath]
   */
  heartbeat(projectPath) {
    this.connected = true;
    this.lastHeartbeat = Date.now();
    if (projectPath && typeof projectPath === 'string') {
      this.connectedProjectPath = projectPath;
    }
  }

  /**
   * Get the daemon's own project root.
   * @returns {string}
   */
  getDaemonProjectPath() {
    return DAEMON_PROJECT_ROOT;
  }

  /**
   * True iff Unity is connected AND the Unity project path matches the daemon's project root.
   * Null if Unity hasn't reported a path yet.
   * @returns {boolean|null}
   */
  isProjectMatch() {
    if (!this.connectedProjectPath) return null;
    return normalisePath(this.connectedProjectPath) === normalisePath(DAEMON_PROJECT_ROOT);
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
      projectPath: this.connectedProjectPath,
      projectMatch: this.isProjectMatch(),
    };
  }
}

module.exports = UnityState;
