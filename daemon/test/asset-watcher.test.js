'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const AssetWatcher = require('../src/asset-watcher');

// These tests exercise the watcher's API surface — dirty/clean semantics and
// the internal dirty-marker used by the fs.watch callback. Actual fs.watch
// integration is not tested: platform-dependent, flaky in CI, and the Node
// fs API itself isn't our code to validate. The _markDirty hook is exposed
// so we can drive state changes deterministically.

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dreamer-watcher-'));
  fs.mkdirSync(path.join(tmpDir, 'Assets'), { recursive: true });
});

afterEach(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

test('fresh watcher is clean and inactive', () => {
  const w = new AssetWatcher(tmpDir);
  assert.equal(w.isDirty(), false);
  assert.equal(w.lastChange, null);
  assert.equal(w.lastChangedFile, null);
});

test('_markDirty flips dirty + records file + timestamp', () => {
  const w = new AssetWatcher(tmpDir);
  const before = Date.now();
  w._markDirty('Scripts/Player.cs');
  assert.equal(w.isDirty(), true);
  assert.equal(w.lastChangedFile, 'Scripts/Player.cs');
  assert.ok(w.lastChange >= before);
});

test('markClean resets dirty but preserves lastChange metadata (audit trail)', () => {
  const w = new AssetWatcher(tmpDir);
  w._markDirty('Scripts/A.cs');
  assert.equal(w.isDirty(), true);
  const changeTs = w.lastChange;
  w.markClean();
  assert.equal(w.isDirty(), false);
  // We intentionally keep lastChange/lastChangedFile around — useful for
  // telling the user WHICH change triggered the last refresh.
  assert.equal(w.lastChange, changeTs);
  assert.equal(w.lastChangedFile, 'Scripts/A.cs');
});

test('start on a project without Assets/ gracefully disables the watcher', () => {
  // Point at a dir that exists but has no Assets/ subdir
  const bareDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dreamer-bare-'));
  const w = new AssetWatcher(bareDir);
  assert.doesNotThrow(() => w.start());
  assert.equal(w._active, false);
  w.stop();
  try { fs.rmSync(bareDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

test('start + stop lifecycle is idempotent', () => {
  const w = new AssetWatcher(tmpDir);
  w.start();
  w.start(); // second start must be a no-op
  assert.equal(w._active, true);
  w.stop();
  w.stop(); // second stop must be a no-op
  assert.equal(w._active, false);
});

test('toJSON reports dirty/active state and lastChange', () => {
  const w = new AssetWatcher(tmpDir);
  w._markDirty('foo.cs');
  const snap = w.toJSON();
  assert.equal(snap.dirty, true);
  assert.equal(snap.lastChangedFile, 'foo.cs');
  assert.equal(typeof snap.lastChange, 'number');
  assert.equal(typeof snap.active, 'boolean');
});
