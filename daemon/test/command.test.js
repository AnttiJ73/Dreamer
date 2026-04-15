'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  createCommand,
  validateTransition,
  isKnownKind,
  isTerminalState,
  isCompileSafe,
  STATES,
  TERMINAL_STATES,
  COMPILE_SAFE_KINDS,
} = require('../src/command');

test('createCommand rejects unknown kinds', () => {
  assert.throws(() => createCommand('bogus_command', {}), /Unknown command kind/);
});

test('createCommand assigns defaults and a UUID id', () => {
  const cmd = createCommand('find_assets', { type: 'prefab' });
  assert.equal(cmd.kind, 'find_assets');
  assert.deepEqual(cmd.args, { type: 'prefab' });
  assert.equal(cmd.state, 'queued');
  assert.equal(cmd.attemptCount, 0);
  assert.equal(cmd.dependsOn, null);
  assert.match(cmd.id, /^[0-9a-f-]{36}$/);
  assert.equal(typeof cmd.createdAt, 'string');
});

test('createCommand attaches auto-requirements for compilation-gated kinds', () => {
  const cmd = createCommand('add_component', { asset: 'x', type: 'y' });
  assert.deepEqual(cmd.requirements, { compilation: true });
});

test('createCommand leaves requirements null for non-gated kinds', () => {
  const cmd = createCommand('find_assets', {});
  assert.equal(cmd.requirements, null);
});

test('createCommand merges explicit requirement overrides', () => {
  const cmd = createCommand('add_component', {}, { requirements: { compilation: false, extra: 1 } });
  assert.deepEqual(cmd.requirements, { compilation: false, extra: 1 });
});

test('createCommand carries originTaskId, humanLabel, priority, dependsOn', () => {
  const cmd = createCommand('save_assets', {}, {
    originTaskId: 'T-1',
    humanLabel: 'Save everything',
    priority: 5,
    dependsOn: 'abc',
  });
  assert.equal(cmd.originTaskId, 'T-1');
  assert.equal(cmd.humanLabel, 'Save everything');
  assert.equal(cmd.priority, 5);
  assert.equal(cmd.dependsOn, 'abc');
});

test('validateTransition permits queued → waiting and queued → dispatched', () => {
  assert.equal(validateTransition('queued', 'waiting').valid, true);
  assert.equal(validateTransition('queued', 'dispatched').valid, true);
});

test('validateTransition blocks running → queued (cannot un-run a command)', () => {
  const result = validateTransition('running', 'queued');
  assert.equal(result.valid, false);
  assert.match(result.reason, /Cannot transition/);
});

test('validateTransition allows waiting → waiting (so waitingReason can update)', () => {
  // Added to fix stale waitingReason — e.g. a command first waits on
  // "unity_disconnected", later the real blocker is "Compile errors present".
  assert.equal(validateTransition('waiting', 'waiting').valid, true);
});

test('validateTransition blocks transitions out of terminal states', () => {
  for (const terminal of TERMINAL_STATES) {
    if (terminal === 'blocked') continue; // blocked → cancelled is allowed
    const result = validateTransition(terminal, 'queued');
    assert.equal(result.valid, false, `${terminal} → queued should be invalid`);
  }
});

test('validateTransition rejects unknown source states', () => {
  const result = validateTransition('nonsense', 'queued');
  assert.equal(result.valid, false);
  assert.match(result.reason, /Unknown state/);
});

test('isKnownKind matches KIND_DEFS keys', () => {
  assert.equal(isKnownKind('add_component'), true);
  assert.equal(isKnownKind('find_assets'), true);
  assert.equal(isKnownKind('not_a_real_kind'), false);
});

test('isTerminalState identifies the four terminal states', () => {
  for (const s of ['succeeded', 'failed', 'blocked', 'cancelled']) {
    assert.equal(isTerminalState(s), true, `${s} should be terminal`);
  }
  for (const s of ['queued', 'waiting', 'dispatched', 'running']) {
    assert.equal(isTerminalState(s), false, `${s} should not be terminal`);
  }
});

test('STATES includes every state referenced by isTerminalState', () => {
  for (const s of TERMINAL_STATES) {
    assert.ok(STATES.includes(s), `STATES missing ${s}`);
  }
});

test('isCompileSafe covers the read-only kinds, nothing else', () => {
  for (const k of COMPILE_SAFE_KINDS) {
    assert.equal(isCompileSafe(k), true);
  }
  for (const k of ['add_component', 'set_property', 'create_prefab', 'create_script', 'instantiate_prefab']) {
    assert.equal(isCompileSafe(k), false, `${k} should not be compile-safe`);
  }
  assert.equal(isCompileSafe('nonexistent_kind'), false);
});
