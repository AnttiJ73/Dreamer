'use strict';

// Watches Assets/ for .cs / asmdef changes; CLI uses isDirty() to auto-prepend
// refresh-assets before compile-gated commands so direct .cs writes work without
// a manual refresh. Backed by fs.watch recursive (native on Windows/macOS;
// best-effort on Linux).

const fs = require('fs');
const path = require('path');
const log = require('./log').create('asset-watcher');

// Compilation-affecting extensions only — .meta spam from Unity's pipeline never warrants a refresh.
const WATCHED_EXTS = new Set(['.cs', '.asmdef', '.asmref']);

class AssetWatcher {
  constructor(projectRoot) {
    this.projectRoot = projectRoot;
    this.assetsDir = path.join(projectRoot, 'Assets');
    this.dirty = false;
    this.lastChange = null;
    this.lastChangedFile = null;
    // Forward-slash "Assets/..." paths consumed by refresh_assets so the bridge
    // can auto-heal misclassified .cs files (DefaultImporter → MonoImporter).
    this.changedFiles = new Set();
    this._watcher = null;
    this._active = false;
  }

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

  stop() {
    if (this._watcher) {
      try { this._watcher.close(); } catch { /* ignore */ }
      this._watcher = null;
    }
    this._active = false;
  }

  isDirty() {
    return this.dirty;
  }

  /** Call after Unity confirms a refresh — clears dirty + changed-files. */
  markClean() {
    this.dirty = false;
    this.changedFiles.clear();
  }

  getChangedFiles() {
    return Array.from(this.changedFiles);
  }

  _markDirty(relativePath) {
    this.dirty = true;
    this.lastChange = Date.now();
    this.lastChangedFile = relativePath;
    const normalized = 'Assets/' + relativePath.replace(/\\/g, '/');
    this.changedFiles.add(normalized);
  }

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
