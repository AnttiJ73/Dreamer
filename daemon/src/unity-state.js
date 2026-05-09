'use strict';

const path = require('path');
const log = require('./log').create('unity-state');
const MAX_CONSOLE_ENTRIES = 200;

/** Canonicalise path for cross-platform equality (slashes, case on Windows, trim trailing). */
function normalisePath(p) {
  if (!p || typeof p !== 'string') return null;
  let n = p.replace(/\\/g, '/').replace(/\/+$/, '');
  if (process.platform === 'win32') n = n.toLowerCase();
  return n;
}

const DAEMON_PROJECT_ROOT = path.resolve(__dirname, '..', '..');

/** Tracks Unity Editor state from heartbeats and state updates. */
class UnityState {
  constructor() {
    this.connected = false;
    this.lastHeartbeat = null;
    this.compiling = false;
    this.compileErrors = [];
    this.playMode = false;
    this.lastCompileSuccess = null;
    // True when lastCompileSuccess was restored from the bridge on reconnect
    // rather than witnessed live — UI uses this to distinguish "saw it" from
    // "Unity says it happened earlier".
    this.lastCompileSourceIsBridge = false;
    // hasReceivedState gates compilation-sensitive dispatch: a fresh daemon
    // with an empty snapshot would otherwise dispatch before the first state
    // tick and Unity would bounce with "Type not found" if errors exist.
    this.hasReceivedState = false;
    this.connectedProjectPath = null;
    this.consoleEntries = [];
  }

  update(state) {
    const wasCompiling = this.compiling;

    if (state.compiling !== undefined) this.compiling = !!state.compiling;
    if (state.compileErrors !== undefined) this.compileErrors = Array.isArray(state.compileErrors) ? state.compileErrors : [];
    if (state.playMode !== undefined) this.playMode = !!state.playMode;
    if (state.projectPath && typeof state.projectPath === 'string') {
      this.connectedProjectPath = state.projectPath;
    }

    if (state.compiling !== undefined || state.compileErrors !== undefined || state.playMode !== undefined) {
      this.hasReceivedState = true;
    }

    this.connected = true;
    this.lastHeartbeat = Date.now();

    // Bridge's lastCompileTime is authoritative when newer — it hooks
    // CompilationPipeline.compilationFinished so it sees every compile.
    // Our own wasCompiling→!compiling edge detection misses short compiles
    // (<2s state-tick interval), which would otherwise leave our timestamp
    // stale across multiple actual recompiles. Also covers daemon-restart
    // restoration via the monotonic-newer guard against a 0 timestamp.
    if (state.lastCompileTime && state.lastCompileSucceeded === true) {
      const bridgeMs = Date.parse(state.lastCompileTime);
      const ourMs = this.lastCompileSuccess ? Date.parse(this.lastCompileSuccess) : 0;
      if (Number.isFinite(bridgeMs) && bridgeMs > ourMs) {
        this.lastCompileSuccess = state.lastCompileTime;
        this.lastCompileSourceIsBridge = true;
      }
    }

    // Secondary path: if we did observe the edge directly (long compiles),
    // stamp the success too — same monotonic gate picks the winner.
    const compilationJustSucceeded =
      wasCompiling && !this.compiling && this.compileErrors.length === 0;

    if (compilationJustSucceeded) {
      const now = new Date().toISOString();
      const nowMs = Date.parse(now);
      const ourMs = this.lastCompileSuccess ? Date.parse(this.lastCompileSuccess) : 0;
      if (nowMs > ourMs) {
        this.lastCompileSuccess = now;
        this.lastCompileSourceIsBridge = false;
      }
    }

    return { compilationJustSucceeded };
  }

  heartbeat(projectPath) {
    const wasConnected = this.connected;
    this.connected = true;
    this.lastHeartbeat = Date.now();
    if (projectPath && typeof projectPath === 'string') {
      this.connectedProjectPath = projectPath;
    }
    if (!wasConnected) {
      log.info('Unity bridge reconnected.');
    }
  }

  getDaemonProjectPath() {
    return DAEMON_PROJECT_ROOT;
  }

  /** true if connected AND project paths match. null if path not yet reported. */
  isProjectMatch() {
    if (!this.connectedProjectPath) return null;
    return normalisePath(this.connectedProjectPath) === normalisePath(DAEMON_PROJECT_ROOT);
  }

  checkConnection(timeoutMs = 25000) {
    if (!this.lastHeartbeat) {
      this.connected = false;
      return;
    }
    const elapsed = Date.now() - this.lastHeartbeat;
    const wasConnected = this.connected;
    if (elapsed > timeoutMs) {
      this.connected = false;
    }
    // Log the connect→disconnect transition with the elapsed time so we can
    // tell "Unity actually quit" from "transient blip past the timeout" in
    // post-mortem (especially under multi-client contention or unfocused
    // Editor on Windows).
    if (wasConnected && !this.connected) {
      log.warn(`Unity bridge marked disconnected after ${(elapsed / 1000).toFixed(1)}s without heartbeat (timeout ${timeoutMs / 1000}s). lastHeartbeat=${new Date(this.lastHeartbeat).toISOString()}`);
    }
    // After 60s disconnected, zero cached state — stale flags (compiling/playMode/
    // errors) all gate dispatch with misleading reasons after Unity comes back,
    // and the first post-reconnect heartbeat will repopulate anyway. Was 30s
    // but that was too aggressive when transient blips trip the connection
    // timeout above.
    if (elapsed > 60000) {
      let cleared = false;
      if (this.compiling)              { this.compiling = false;     cleared = true; }
      if (this.playMode)               { this.playMode = false;      cleared = true; }
      if (this.compileErrors.length)   { this.compileErrors = [];    cleared = true; }
      if (cleared) {
        log.info('Resetting stale editor state (compiling/playMode/errors) after prolonged disconnect');
      }
    }
  }

  isReady() {
    return this.connected && !this.compiling;
  }

  isCompiling() {
    return this.compiling;
  }

  getCompileErrors() {
    return this.compileErrors;
  }

  /** Append to console ring buffer (capped at MAX_CONSOLE_ENTRIES). */
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
    if (this.consoleEntries.length > MAX_CONSOLE_ENTRIES) {
      this.consoleEntries = this.consoleEntries.slice(-MAX_CONSOLE_ENTRIES);
    }
  }

  getConsole(count = 50) {
    const n = Math.max(1, Math.min(count, this.consoleEntries.length));
    return this.consoleEntries.slice(-n);
  }

  toJSON() {
    return {
      connected: this.connected,
      lastHeartbeat: this.lastHeartbeat,
      compiling: this.compiling,
      compileErrors: this.compileErrors,
      playMode: this.playMode,
      lastCompileSuccess: this.lastCompileSuccess,
      lastCompileSourceIsBridge: this.lastCompileSourceIsBridge,
      projectPath: this.connectedProjectPath,
      projectMatch: this.isProjectMatch(),
    };
  }
}

module.exports = UnityState;
