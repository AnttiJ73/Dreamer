'use strict';

/**
 * Watches the project's Assets/ directory for C# / asmdef changes and
 * exposes a "dirty" flag meaning "Unity has not yet imported these changes."
 *
 * Why: agents commonly write .cs files directly (via their native file tools)
 * and skip ./bin/dreamer refresh-assets. When a later compile-gated command
 * runs, Unity hasn't imported the new file and returns misleading "Type not
 * found" / "Property not found" errors. The CLI uses isDirty() to decide
 * whether to auto-prepend a refresh-assets before compile-gated commands,
 * making the "direct write, no refresh" workflow Just Work.
 *
 * Backed by Node's fs.watch with recursive:true. Supported natively on
 * Windows and macOS; on Linux, fs.watch recursive is best-effort but fs.watch
 * itself still fires for top-level changes.
 */

const fs = require('fs');
const path = require('path');
const log = require('./log').create('asset-watcher');

// Only extensions that affect compilation matter. Ignore .meta spam from
// Unity's own asset pipeline — those fire constantly and don't need a refresh.
const WATCHED_EXTS = new Set(['.cs', '.asmdef', '.asmref']);

class AssetWatcher {
  /**
   * @param {string} projectRoot - Absolute path to the Unity project root.
   */
  constructor(projectRoot) {
    this.projectRoot = projectRoot;
    this.assetsDir = path.join(projectRoot, 'Assets');
    this.dirty = false;
    /** Epoch ms of most recent relevant change, or null. */
    this.lastChange = null;
    /** Relative path (under Assets/) of most recent change, or null. */
    this.lastChangedFile = null;
    /**
     * Set of forward-slash "Assets/..."-prefixed paths that have changed since
     * the last markClean(). Consumed by `refresh_assets` so Unity's bridge can
     * auto-heal misclassified .cs files (DefaultImporter instead of
     * MonoImporter) with a targeted force-import before returning.
     * @type {Set<string>}
     */
    this.changedFiles = new Set();
    this._watcher = null;
    this._active = false;
  }

  /** Start watching. No-op if already active or Assets/ is missing. */
  start() {
    if (this._active) return;
    if (!fs.existsSync(this.assetsDir)) {
      log.warn(`Assets/ not found at ${this.assetsDir}; asset watcher disabled.`);
      return;
    }
    try {
      this._watcher = fs.watch(this.assetsDir, { recursive: true }, (event, filename) => {
        if (!filename) return;
        const ext = path.extname(filename).toLowerCase();
        if (!WATCHED_EXTS.has(ext)) return;
        this._markDirty(filename);
      });
      this._active = true;
      log.info(`Watching ${this.assetsDir} for .cs / .asmdef changes`);
    } catch (err) {
      log.error(`Failed to start fs.watch: ${err.message}`);
    }
  }

  /** Stop watching and release the native handle. */
  stop() {
    if (this._watcher) {
      try { this._watcher.close(); } catch { /* ignore */ }
      this._watcher = null;
    }
    this._active = false;
  }

  /** @returns {boolean} true if any watched file has changed since last markClean(). */
  isDirty() {
    return this.dirty;
  }

  /**
   * Mark clean — call after Unity has processed a refresh-assets so we stop
   * auto-prepending more refreshes. Clears both the dirty flag and the
   * changed-files set.
   */
  markClean() {
    this.dirty = false;
    this.changedFiles.clear();
  }

  /**
   * Return a snapshot of the changed files accumulated since the last
   * markClean(), with paths normalized to forward-slash "Assets/..." form
   * so they're ready to hand to Unity's AssetDatabase API.
   * @returns {string[]}
   */
  getChangedFiles() {
    return Array.from(this.changedFiles);
  }

  /**
   * Test-only. Simulates a filesystem change without touching fs.watch.
   * @param {string} relativePath - path relative to Assets/ (what fs.watch gives us)
   */
  _markDirty(relativePath) {
    this.dirty = true;
    this.lastChange = Date.now();
    this.lastChangedFile = relativePath;
    // Normalize to forward-slash "Assets/..." form that AssetDatabase expects.
    const normalized = 'Assets/' + relativePath.replace(/\\/g, '/');
    this.changedFiles.add(normalized);
  }

  /** Serialisable snapshot for /api/status. */
  toJSON() {
    return {
      active: this._active,
      dirty: this.dirty,
      lastChange: this.lastChange,
      lastChangedFile: this.lastChangedFile,
      changedFileCount: this.changedFiles.size,
    };
  }
}

module.exports = AssetWatcher;
