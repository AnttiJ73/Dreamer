'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { validate } = require('../src/validate');

test('accepts args that satisfy a minimal schema', () => {
  const schema = { args: { name: { type: 'string', required: true } } };
  const { valid, errors } = validate(schema, { name: 'Player' });
  assert.equal(valid, true);
  assert.deepEqual(errors, []);
});

test('reports missing required arg', () => {
  const schema = { args: { name: { type: 'string', required: true } } };
  const { valid, errors } = validate(schema, {});
  assert.equal(valid, false);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /Missing required arg: 'name'/);
});

test('missing optional arg is fine', () => {
  const schema = { args: { name: { type: 'string' } } };
  assert.equal(validate(schema, {}).valid, true);
});

test('reports type mismatch with both expected and actual types', () => {
  const schema = { args: { count: { type: 'number' } } };
  const { valid, errors } = validate(schema, { count: 'three' });
  assert.equal(valid, false);
  assert.match(errors[0], /arg 'count' must be number, got string/);
});

test('accepts any value for type: "any"', () => {
  const schema = { args: { payload: { type: 'any', required: true } } };
  assert.equal(validate(schema, { payload: 'str' }).valid, true);
  assert.equal(validate(schema, { payload: 42 }).valid, true);
  assert.equal(validate(schema, { payload: { k: 'v' } }).valid, true);
  assert.equal(validate(schema, { payload: [1, 2] }).valid, true);
});

test('distinguishes arrays from objects', () => {
  const arrSchema = { args: { items: { type: 'array' } } };
  assert.equal(validate(arrSchema, { items: [1, 2, 3] }).valid, true);
  assert.equal(validate(arrSchema, { items: { 0: 1 } }).valid, false);

  const objSchema = { args: { config: { type: 'object' } } };
  assert.equal(validate(objSchema, { config: { k: 'v' } }).valid, true);
  assert.equal(validate(objSchema, { config: [1] }).valid, false);
});

test('enum rejects values not in the allow-list', () => {
  const schema = { args: { template: { type: 'string', enum: ['monobehaviour', 'editor'] } } };
  assert.equal(validate(schema, { template: 'monobehaviour' }).valid, true);
  const { valid, errors } = validate(schema, { template: 'something-else' });
  assert.equal(valid, false);
  assert.match(errors[0], /must be one of/);
});

test('exactlyOne constraint: zero provided → error', () => {
  const schema = {
    args: { asset: { type: 'string' }, sceneObject: { type: 'string' } },
    constraints: [{ rule: 'exactlyOne', fields: ['asset', 'sceneObject'] }],
  };
  const { valid, errors } = validate(schema, {});
  assert.equal(valid, false);
  assert.match(errors[0], /Exactly one of/);
});

test('exactlyOne constraint: both provided → error', () => {
  const schema = {
    args: { asset: { type: 'string' }, sceneObject: { type: 'string' } },
    constraints: [{ rule: 'exactlyOne', fields: ['asset', 'sceneObject'] }],
  };
  const { valid, errors } = validate(schema, { asset: 'a', sceneObject: 'b' });
  assert.equal(valid, false);
  assert.match(errors[0], /Only one of/);
});

test('exactlyOne constraint: one provided → OK', () => {
  const schema = {
    args: { asset: { type: 'string' }, sceneObject: { type: 'string' } },
    constraints: [{ rule: 'exactlyOne', fields: ['asset', 'sceneObject'] }],
  };
  assert.equal(validate(schema, { asset: 'a' }).valid, true);
  assert.equal(validate(schema, { sceneObject: 'b' }).valid, true);
});

test('atLeastOne constraint: zero → error, one or more → OK', () => {
  const schema = {
    args: { a: { type: 'string' }, b: { type: 'string' } },
    constraints: [{ rule: 'atLeastOne', fields: ['a', 'b'] }],
  };
  assert.equal(validate(schema, {}).valid, false);
  assert.equal(validate(schema, { a: 'x' }).valid, true);
  assert.equal(validate(schema, { a: 'x', b: 'y' }).valid, true);
});

test('null/undefined args treated as missing (not type-checked)', () => {
  const schema = { args: { x: { type: 'string' } } };
  assert.equal(validate(schema, { x: null }).valid, true, 'null = missing, no required');
  assert.equal(validate(schema, { x: undefined }).valid, true);
});

test('treats a non-object args input as empty input', () => {
  const schema = { args: { x: { type: 'string', required: true } } };
  assert.equal(validate(schema, null).valid, false);
  assert.equal(validate(schema, 'not an object').valid, false);
  assert.equal(validate(schema, [1, 2]).valid, false);
});

// Registry smoke tests — ensure every shipped schema loads and has required fields
test('schema registry loads every shipped schema with a kind, args, and summary', () => {
  const schemas = require('../src/schemas');
  const kinds = schemas.list();
  assert.ok(kinds.length >= 5, `expected ≥5 schemas, got ${kinds.length}`);
  for (const k of kinds) {
    const s = schemas.get(k);
    assert.equal(s.kind, k);
    assert.equal(typeof s.summary, 'string', `${k} missing summary`);
    assert.equal(typeof s.args, 'object', `${k} missing args`);
  }
});

test('add_component schema rejects missing typeName and no target', () => {
  const schemas = require('../src/schemas');
  const s = schemas.get('add_component');
  assert.ok(s);

  // Missing 'typeName' + no target → multiple errors
  let r = validate(s, {});
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => /Missing required arg: 'typeName'/.test(e)));
  assert.ok(r.errors.some((e) => /At least one of/.test(e)));

  // assetPath + guid together are fine (Unity treats guid as fallback)
  r = validate(s, { assetPath: 'Assets/Prefabs/P.prefab', guid: 'abc123', typeName: 'Game.X' });
  assert.equal(r.valid, true);

  // Valid: one target + typeName
  assert.equal(validate(s, { assetPath: 'Assets/Prefabs/P.prefab', typeName: 'Game.X' }).valid, true);
  assert.equal(validate(s, { sceneObjectPath: 'Main Camera', typeName: 'UnityEngine.AudioListener' }).valid, true);
});
