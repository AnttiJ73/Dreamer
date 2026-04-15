'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  COMPILATION_TRIGGERING_KINDS,
  VALID_MODES,
  resolveFocusMode,
  shouldFocusUpfront,
} = require('../src/focus-policy');

// ── resolveFocusMode ────────────────────────────────────────────────────────

test('resolveFocusMode: boolean true → "always" (legacy)', () => {
  assert.equal(resolveFocusMode(true), 'always');
});

test('resolveFocusMode: boolean false → "never" (legacy)', () => {
  assert.equal(resolveFocusMode(false), 'never');
});

test('resolveFocusMode: passes through valid string modes', () => {
  for (const mode of VALID_MODES) {
    assert.equal(resolveFocusMode(mode), mode);
  }
});

test('resolveFocusMode: defaults to "smart" for undefined / null / bad values', () => {
  assert.equal(resolveFocusMode(undefined), 'smart');
  assert.equal(resolveFocusMode(null), 'smart');
  assert.equal(resolveFocusMode('bogus'), 'smart');
  assert.equal(resolveFocusMode(42), 'smart');
});

// ── shouldFocusUpfront — flag precedence ────────────────────────────────────

test('--focus wins regardless of mode or kind', () => {
  assert.equal(shouldFocusUpfront('find_assets', { focus: true }, { autoFocus: 'never' }), true);
  assert.equal(shouldFocusUpfront('create_script', { focus: true }, { autoFocus: 'smart' }), true);
});

test('--no-focus wins regardless of mode or kind', () => {
  assert.equal(shouldFocusUpfront('create_script', { 'no-focus': true }, { autoFocus: 'always' }), false);
  assert.equal(shouldFocusUpfront('add_component', { 'no-focus': true }, { autoFocus: 'smart' }), false);
});

test('--focus and --no-focus together: --focus wins (explicit check)', () => {
  // shouldFocusUpfront checks focus first
  assert.equal(shouldFocusUpfront('find_assets', { focus: true, 'no-focus': true }, {}), true);
});

// ── mode: always ────────────────────────────────────────────────────────────

test('always mode: focuses every kind', () => {
  for (const kind of ['find_assets', 'create_script', 'set_property', 'add_component']) {
    assert.equal(shouldFocusUpfront(kind, {}, { autoFocus: 'always' }), true, `kind=${kind}`);
  }
});

// ── mode: never ─────────────────────────────────────────────────────────────

test('never mode: skips focus for every kind', () => {
  for (const kind of ['find_assets', 'create_script', 'set_property', 'add_component']) {
    assert.equal(shouldFocusUpfront(kind, {}, { autoFocus: 'never' }), false, `kind=${kind}`);
  }
});

// ── mode: smart (default) ───────────────────────────────────────────────────

test('smart mode focuses only compilation-triggering kinds', () => {
  for (const kind of COMPILATION_TRIGGERING_KINDS) {
    assert.equal(shouldFocusUpfront(kind, {}, { autoFocus: 'smart' }), true, `${kind} should upfront-focus`);
  }
});

test('smart mode skips focus for ordinary kinds', () => {
  for (const kind of ['find_assets', 'inspect', 'set_property', 'add_component', 'remove_component']) {
    assert.equal(shouldFocusUpfront(kind, {}, { autoFocus: 'smart' }), false, `${kind} should NOT upfront-focus`);
  }
});

test('smart is the default when autoFocus is unset', () => {
  assert.equal(shouldFocusUpfront('create_script', {}, {}), true);
  assert.equal(shouldFocusUpfront('find_assets', {}, {}), false);
});

test('smart is the default when config is null/undefined', () => {
  assert.equal(shouldFocusUpfront('create_script', {}, null), true);
  assert.equal(shouldFocusUpfront('create_script', {}, undefined), true);
  assert.equal(shouldFocusUpfront('find_assets', {}, null), false);
});
