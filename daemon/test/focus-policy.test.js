'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  VALID_MODES,
  DEFAULT_MODE,
  resolveFocusMode,
  shouldFocusUpfront,
  shouldFallbackFocus,
} = require('../src/focus-policy');

// ── resolveFocusMode ────────────────────────────────────────────────────────

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
  // Booleans are no longer a valid config — they fall through to default.
  assert.equal(resolveFocusMode(true), 'smart');
  assert.equal(resolveFocusMode(false), 'smart');
});

test('DEFAULT_MODE is "smart"', () => {
  assert.equal(DEFAULT_MODE, 'smart');
});

// ── shouldFocusUpfront — flag precedence ────────────────────────────────────

test('--focus wins regardless of mode or kind', () => {
  assert.equal(shouldFocusUpfront('find_assets', { focus: true }, { autoFocus: 'never' }), true);
  assert.equal(shouldFocusUpfront('create_script', { focus: true }, { autoFocus: 'smart' }), true);
});

test('--no-focus wins regardless of mode', () => {
  assert.equal(shouldFocusUpfront('create_script', { 'no-focus': true }, { autoFocus: 'always' }), false);
  assert.equal(shouldFocusUpfront('add_component', { 'no-focus': true }, { autoFocus: 'smart' }), false);
});

test('--focus beats --no-focus when both are set (explicit-focus wins)', () => {
  assert.equal(shouldFocusUpfront('find_assets', { focus: true, 'no-focus': true }, {}), true);
});

// ── shouldFocusUpfront — mode behavior ──────────────────────────────────────

test('always mode: focuses every kind', () => {
  for (const kind of ['find_assets', 'create_script', 'set_property', 'add_component']) {
    assert.equal(shouldFocusUpfront(kind, {}, { autoFocus: 'always' }), true, `kind=${kind}`);
  }
});

test('never mode: skips focus for every kind', () => {
  for (const kind of ['find_assets', 'create_script', 'set_property', 'add_component']) {
    assert.equal(shouldFocusUpfront(kind, {}, { autoFocus: 'never' }), false, `kind=${kind}`);
  }
});

test('smart mode: NEVER focuses upfront (fallback handles stalls instead)', () => {
  for (const kind of ['find_assets', 'create_script', 'set_property', 'add_component', 'refresh_assets']) {
    assert.equal(shouldFocusUpfront(kind, {}, { autoFocus: 'smart' }), false, `kind=${kind}`);
  }
});

test('default config (unset autoFocus) is smart, no upfront focus', () => {
  assert.equal(shouldFocusUpfront('create_script', {}, {}), false);
  assert.equal(shouldFocusUpfront('find_assets', {}, {}), false);
  assert.equal(shouldFocusUpfront('create_script', {}, null), false);
  assert.equal(shouldFocusUpfront('create_script', {}, undefined), false);
});

// ── shouldFallbackFocus ─────────────────────────────────────────────────────

test('shouldFallbackFocus: smart mode, no upfront focus, no --no-focus → true', () => {
  assert.equal(shouldFallbackFocus({}, { autoFocus: 'smart' }, false), true);
  assert.equal(shouldFallbackFocus({}, {}, false), true); // default = smart
});

test('shouldFallbackFocus: --no-focus suppresses the fallback', () => {
  assert.equal(shouldFallbackFocus({ 'no-focus': true }, { autoFocus: 'smart' }, false), false);
});

test('shouldFallbackFocus: if we focused upfront, no fallback needed', () => {
  assert.equal(shouldFallbackFocus({}, { autoFocus: 'smart' }, true), false);
});

test('shouldFallbackFocus: always mode does not fallback (already focused upfront)', () => {
  assert.equal(shouldFallbackFocus({}, { autoFocus: 'always' }, true), false);
});

test('shouldFallbackFocus: never mode does not fallback', () => {
  assert.equal(shouldFallbackFocus({}, { autoFocus: 'never' }, false), false);
});
