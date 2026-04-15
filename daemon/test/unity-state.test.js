'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const UnityState = require('../src/unity-state');

test('new state is disconnected with no heartbeat', () => {
  const s = new UnityState();
  assert.equal(s.connected, false);
  assert.equal(s.lastHeartbeat, null);
  assert.equal(s.connectedProjectPath, null);
});

test('heartbeat() marks connected and records timestamp', () => {
  const s = new UnityState();
  const before = Date.now();
  s.heartbeat();
  assert.equal(s.connected, true);
  assert.ok(s.lastHeartbeat >= before);
});

test('heartbeat(projectPath) records the Unity project root', () => {
  const s = new UnityState();
  s.heartbeat('/tmp/MyUnityProject');
  assert.equal(s.connectedProjectPath, '/tmp/MyUnityProject');
});

test('update() merges partial state and flags compilationJustSucceeded on wasCompiling→!compiling transition', () => {
  const s = new UnityState();
  s.update({ compiling: true });
  const r1 = s.update({ compiling: false });
  assert.equal(r1.compilationJustSucceeded, true);
  assert.ok(s.lastCompileSuccess);
  const r2 = s.update({ compiling: false });
  assert.equal(r2.compilationJustSucceeded, false, 'should not re-fire while still not compiling');
});

test('update() does NOT flag compilationJustSucceeded when errors remain', () => {
  const s = new UnityState();
  s.update({ compiling: true });
  const r = s.update({ compiling: false, compileErrors: ['CS1234: bad code'] });
  assert.equal(r.compilationJustSucceeded, false);
});

test('update() captures projectPath from state payload', () => {
  const s = new UnityState();
  s.update({ compiling: false, projectPath: '/tmp/AnotherProject' });
  assert.equal(s.connectedProjectPath, '/tmp/AnotherProject');
});

test('hasReceivedState is false until first state-bearing update', () => {
  const s = new UnityState();
  assert.equal(s.hasReceivedState, false);
  s.heartbeat(); // heartbeat alone does not count
  assert.equal(s.hasReceivedState, false);
  s.heartbeat('/some/project'); // still heartbeat, not a state report
  assert.equal(s.hasReceivedState, false);
  s.update({ compiling: false }); // real state report
  assert.equal(s.hasReceivedState, true);
});

test('hasReceivedState flips on any of {compiling, compileErrors, playMode}', () => {
  for (const key of ['compiling', 'compileErrors', 'playMode']) {
    const s = new UnityState();
    const payload = {};
    payload[key] = key === 'compileErrors' ? [] : false;
    s.update(payload);
    assert.equal(s.hasReceivedState, true, `${key} should set hasReceivedState`);
  }
});

test('isProjectMatch returns null when Unity has not reported a path', () => {
  const s = new UnityState();
  assert.equal(s.isProjectMatch(), null);
});

test('isProjectMatch compares Unity path to daemon project root, case-insensitive on Windows', () => {
  const s = new UnityState();
  const daemonRoot = s.getDaemonProjectPath();

  // Exact match
  s.heartbeat(daemonRoot);
  assert.equal(s.isProjectMatch(), true);

  // Separator variation
  s.heartbeat(daemonRoot.replace(/\\/g, '/'));
  assert.equal(s.isProjectMatch(), true);

  // Clearly different path
  s.heartbeat('/somewhere/else');
  assert.equal(s.isProjectMatch(), false);
});

test('checkConnection disconnects after timeout', () => {
  const s = new UnityState();
  s.heartbeat();
  // Force lastHeartbeat into the past
  s.lastHeartbeat = Date.now() - 60000;
  s.checkConnection(1000);
  assert.equal(s.connected, false);
});

test('checkConnection resets stale compiling flag after prolonged disconnect (>30s)', () => {
  const s = new UnityState();
  s.update({ compiling: true });
  s.lastHeartbeat = Date.now() - 31000;
  s.checkConnection(1000);
  assert.equal(s.compiling, false);
});

test('addConsoleEntries caps buffer at 200 entries', () => {
  const s = new UnityState();
  const entries = [];
  for (let i = 0; i < 300; i++) {
    entries.push({ type: 'Log', message: `msg-${i}` });
  }
  s.addConsoleEntries(entries);
  assert.equal(s.consoleEntries.length, 200);
  // Should retain the *most recent* 200
  assert.equal(s.consoleEntries[199].message, 'msg-299');
  assert.equal(s.consoleEntries[0].message, 'msg-100');
});

test('toJSON includes projectPath and projectMatch fields', () => {
  const s = new UnityState();
  s.heartbeat('/some/project');
  const j = s.toJSON();
  assert.equal(j.projectPath, '/some/project');
  assert.equal(typeof j.projectMatch, 'boolean');
});
