'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CommandQueue = require('../src/queue');
const { createCommand } = require('../src/command');

let tmpDir;
let queueFile;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dreamer-queue-'));
  queueFile = path.join(tmpDir, 'q.json');
});

afterEach(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

test('add / get round-trip a command by id', () => {
  const q = new CommandQueue(queueFile);
  const cmd = createCommand('find_assets', { type: 'prefab' });
  q.add(cmd);
  assert.deepEqual(q.get(cmd.id), cmd);
});

test('get returns null for unknown id', () => {
  const q = new CommandQueue(queueFile);
  assert.equal(q.get('nope'), null);
});

test('update applies a legal state transition and touches updatedAt', async () => {
  const q = new CommandQueue(queueFile);
  const cmd = createCommand('find_assets', {});
  q.add(cmd);
  const originalUpdatedAt = cmd.updatedAt;
  // tiny delay so the ISO timestamp differs
  await new Promise((r) => setTimeout(r, 5));
  q.update(cmd.id, { state: 'dispatched' });
  const updated = q.get(cmd.id);
  assert.equal(updated.state, 'dispatched');
  assert.notEqual(updated.updatedAt, originalUpdatedAt);
});

test('update throws on an illegal transition (running → queued)', () => {
  const q = new CommandQueue(queueFile);
  const cmd = createCommand('find_assets', {});
  q.add(cmd);
  q.update(cmd.id, { state: 'dispatched' });
  q.update(cmd.id, { state: 'running' });
  assert.throws(() => q.update(cmd.id, { state: 'queued' }), /transition/i);
});

test('update sets completedAt when moving to a terminal state', () => {
  const q = new CommandQueue(queueFile);
  const cmd = createCommand('find_assets', {});
  q.add(cmd);
  q.update(cmd.id, { state: 'dispatched' });
  q.update(cmd.id, { state: 'running' });
  q.update(cmd.id, { state: 'succeeded', result: { ok: true } });
  const done = q.get(cmd.id);
  assert.equal(done.state, 'succeeded');
  assert.ok(done.completedAt, 'completedAt should be set on terminal state');
  assert.deepEqual(done.result, { ok: true });
});

test('persistence round-trips: shutdown → new queue.load() sees same commands', () => {
  const q1 = new CommandQueue(queueFile);
  const cmd = createCommand('find_assets', { name: 'Player' });
  q1.add(cmd);
  q1.shutdown();

  const q2 = new CommandQueue(queueFile);
  q2.load();
  assert.deepEqual(q2.get(cmd.id), cmd);
});

test('load is a no-op when the file does not exist', () => {
  const q = new CommandQueue(queueFile);
  assert.doesNotThrow(() => q.load());
  assert.equal(q.get('anything'), null);
});
