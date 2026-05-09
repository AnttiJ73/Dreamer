#!/usr/bin/env node
// End-to-end CLI integration test for the Node-side commands. Spawns
// `./bin/dreamer ...` for each, verifies it returns 0 + valid JSON. Also
// asserts the result body has the expected shape (no envelope leaking through).
//
// Run before any change to the CLI dispatcher or unity-yaml modules.

'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
process.chdir(root);

let pass = 0, fail = 0;
const failures = [];

function dreamer(args) {
  const r = spawnSync(process.platform === 'win32' ? 'bin\\dreamer.cmd' : './bin/dreamer', args, {
    cwd: root,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  return {
    code: r.status,
    stdout: r.stdout || '',
    stderr: r.stderr || '',
  };
}

function check(label, args, validate, opts = {}) {
  const r = dreamer(args);
  if (r.code !== 0) {
    fail++;
    failures.push({ label, error: `exit ${r.code} stderr: ${r.stderr.slice(0, 200)}` });
    return;
  }
  if (opts.expectEmptyStdout) {
    if (r.stdout.trim() !== '') {
      fail++;
      failures.push({ label, error: `expected empty stdout, got: ${r.stdout.slice(0, 100)}` });
      return;
    }
    pass++;
    return;
  }
  let json;
  try { json = JSON.parse(r.stdout); }
  catch (e) {
    fail++;
    failures.push({ label, error: `non-JSON stdout: ${r.stdout.slice(0, 200)}` });
    return;
  }
  try {
    validate(json);
    pass++;
  } catch (e) {
    fail++;
    failures.push({ label, error: 'shape: ' + e.message });
  }
}

function assertHas(obj, ...keys) {
  for (const k of keys) {
    if (!(k in obj)) throw new Error(`missing key '${k}'`);
  }
}

function assertNoEnvelope(obj) {
  // The new CLI output strips the queue envelope. If any of these leak
  // through we regressed.
  for (const k of ['id', 'state', 'createdAt', 'dispatchedAt', 'completedAt', 'attemptCount']) {
    if (k in obj) throw new Error(`envelope field leaked: '${k}'`);
  }
}

console.log('=== find-assets ===');
check('find-assets type=prefab', ['find-assets', '--type', 'prefab'], r => {
  assertHas(r, 'assets', 'count', 'totalFound');
  assertNoEnvelope(r);
  if (r.count < 1) throw new Error('expected >=1 prefab in this project');
});
check('find-assets type=material', ['find-assets', '--type', 'material'], r => {
  assertHas(r, 'assets', 'count');
  assertNoEnvelope(r);
});
check('find-assets type=script', ['find-assets', '--type', 'script'], r => {
  assertHas(r, 'assets', 'count');
  if (r.count < 1) throw new Error('expected scripts in this project');
});
check('find-assets type=texture', ['find-assets', '--type', 'texture'], r => {
  assertHas(r, 'assets', 'count');
});
check('find-assets type=scene', ['find-assets', '--type', 'scene'], r => {
  assertHas(r, 'assets', 'count');
});
check('find-assets name filter', ['find-assets', '--name', 'Sparkle'], r => {
  assertHas(r, 'assets', 'count');
});
check('find-assets path filter', ['find-assets', '--path', 'Assets/Materials'], r => {
  assertHas(r, 'assets', 'count');
});

console.log('=== inspect (prefab) ===');
check('inspect SparkleEffect', ['inspect', 'Assets/_DreamerTest/SparkleEffect.prefab'], r => {
  assertHas(r, 'path', 'guid', 'type', 'name', 'components');
  assertNoEnvelope(r);
  if (!Array.isArray(r.components)) throw new Error('components not array');
  if (r.components.length === 0) throw new Error('expected components');
});
check('inspect with --include-transforms', ['inspect', 'Assets/_DreamerTest/SparkleEffect.prefab', '--include-transforms'], r => {
  assertHas(r, 'transform');
  assertHas(r.transform, 'localPosition', 'localScale');
});
check('inspect by guid', ['inspect', '2b23025891760da42b1295971fee7bfb'], r => {
  assertHas(r, 'path', 'guid', 'name');
  if (r.name !== 'SparkleEffect') throw new Error(`name=${r.name}`);
});
check('inspect prefab w/ children', ['inspect', 'Assets/Prefabs/UI/InventoryUI.prefab'], r => {
  assertHas(r, 'children');
  if (!Array.isArray(r.children)) throw new Error('children not array');
  if (r.children.length === 0) throw new Error('expected child');
});

console.log('=== inspect (material) — runs Unity-side now (shader metadata needs ShaderUtil) ===');
check('inspect-material', ['inspect-material', '--asset', 'Assets/Materials/SparkleEffect_Particle.mat'], r => {
  assertHas(r, 'assetPath', 'guid', 'shader', 'properties');
  assertNoEnvelope(r);
});

console.log('=== inspect (scene file) ===');
check('inspect scene', ['inspect', 'Assets/Scenes/DreamerUITest.unity'], r => {
  assertHas(r, 'rootGameObjectCount', 'rootGameObjects');
  assertNoEnvelope(r);
});

console.log('=== inspect-build-scenes ===');
check('inspect-build-scenes', ['inspect-build-scenes'], r => {
  assertHas(r, 'count', 'scenes');
  assertNoEnvelope(r);
});

console.log('=== inspect-project-settings ===');
check('inspect-project-settings', ['inspect-project-settings'], r => {
  assertHas(r, 'tags', 'layers');
  assertNoEnvelope(r);
  if (!Array.isArray(r.layers) || r.layers.length !== 32) throw new Error('layers should be length 32');
});

console.log('=== inspect-player-settings ===');
check('inspect-player-settings', ['inspect-player-settings'], r => {
  assertHas(r, 'companyName', 'productName');
  assertNoEnvelope(r);
});

console.log('=== inspect-hierarchy (prefab + scene file) ===');
check('inspect-hierarchy --asset PREFAB', ['inspect-hierarchy', '--asset', 'Assets/_DreamerTest/SparkleEffect.prefab'], r => {
  assertHas(r, 'assetPath', 'guid', 'source', 'root');
  if (r.source !== 'prefab') throw new Error(`source=${r.source}`);
  assertHas(r.root, 'name', 'components');
  if (r.root.name !== 'SparkleEffect') throw new Error(`root.name=${r.root.name}`);
});
check('inspect-hierarchy --scene FILE', ['inspect-hierarchy', '--scene', 'Assets/Scenes/DreamerUITest.unity'], r => {
  assertHas(r, 'assetPath', 'guid', 'source', 'root');
  assertHas(r.root, 'rootGameObjectCount', 'rootGameObjects');
  if (r.root.rootGameObjectCount === 0) throw new Error('expected root gameobjects');
});

console.log('=== inspect-many ===');
check('inspect-many (2 prefabs)', [
  'inspect-many', '--paths',
  'Assets/_DreamerTest/SparkleEffect.prefab,Assets/_DreamerTest/FireEffect.prefab',
], r => {
  assertHas(r, 'count', 'succeeded', 'items');
  if (r.count !== 2 || r.succeeded !== 2) throw new Error(`expected 2/2, got ${r.succeeded}/${r.count}`);
});

console.log('=== Other previously-shipped commands (regression) ===');
check('search', ['search', 'delete'], r => {
  assertHas(r, 'query', 'count', 'kinds', 'results');
  if (typeof r.kinds !== 'string') throw new Error('kinds should be a string');
});
check('help (no args)', ['help'], r => {
  assertHas(r, 'documented');
});
check('config get', ['config', 'get'], r => {
  if (typeof r !== 'object') throw new Error('expected object');
});
check('prewarm', ['prewarm'], null, { expectEmptyStdout: true });

console.log('=== --unity flag (force Unity path; with Unity disconnected this should still queue without erroring upfront) ===');
// We can't fully test this without Unity, but we can verify the CLI accepts
// the flag and forms a queued command (using --no-wait so we don't hang).
check('inspect --unity --no-wait', [
  'inspect', 'Assets/_DreamerTest/SparkleEffect.prefab', '--unity', '--no-wait',
], r => {
  // With --no-wait + --unity, we'll see a queued command envelope.
  if (!r.id || !r.kind) throw new Error('expected queue envelope with id+kind');
  if (r.kind !== 'inspect_asset') throw new Error(`kind=${r.kind}`);
});

console.log();
console.log(`${pass} pass / ${fail} fail`);
if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  ${f.label}\n    ${f.error}`);
  process.exit(1);
}
