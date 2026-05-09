#!/usr/bin/env node
// Smoke-test every Node-side inspector against real project assets. Reports
// per-asset success/failure. Intended for regression — run before changes
// to the unity-yaml modules to verify nothing breaks.

'use strict';

const fs = require('fs');
const path = require('path');
const { findAssets } = require('../src/unity-yaml/find-assets');
const { inspectAsset } = require('../src/unity-yaml/inspect');
const ps = require('../src/unity-yaml/inspect-project-settings');

const root = path.resolve(__dirname, '..', '..');
process.chdir(root);

let pass = 0, fail = 0;
const failures = [];

function check(label, fn) {
  try {
    const r = fn();
    if (r && r.error) { fail++; failures.push({ label, error: r.error }); return; }
    if (!r) { fail++; failures.push({ label, error: 'returned null/undefined' }); return; }
    pass++;
  } catch (e) {
    fail++;
    failures.push({ label, error: 'THREW: ' + e.message });
  }
}

console.log('=== find_assets ===');
check('find_assets type=prefab',     () => findAssets({ type: 'prefab' }));
check('find_assets type=material',   () => findAssets({ type: 'material' }));
check('find_assets type=scene',      () => findAssets({ type: 'scene' }));
check('find_assets type=script',     () => findAssets({ type: 'script' }));
check('find_assets type=texture',    () => findAssets({ type: 'texture' }));
check('find_assets name=Sparkle',    () => findAssets({ name: 'Sparkle' }));
check('find_assets path=Assets/Materials', () => findAssets({ path: 'Assets/Materials' }));
check('find_assets bad-folder',      () => {
  const r = findAssets({ path: 'Assets/DoesNotExist' });
  if (!r.error) throw new Error('expected error');
  return { ok: true };
});

// Project-only assets — skip Packages/ entries since their physical files
// live in Library/PackageCache and need extra resolution that this sweep
// doesn't perform. Project asset paths under Assets/ always resolve.
function projectOnly(list) {
  return list.filter(a => a.path.startsWith('Assets/'));
}

console.log('=== inspect_asset (prefabs) ===');
const prefabs = projectOnly(findAssets({ type: 'prefab' }).assets);
for (const p of prefabs.slice(0, 30)) {
  check(`inspect ${p.path}`, () => inspectAsset({ assetPath: p.path }));
}

console.log('=== inspect_asset (materials) ===');
const mats = projectOnly(findAssets({ type: 'material' }).assets);
for (const m of mats.slice(0, 20)) {
  check(`inspect ${m.path}`, () => inspectAsset({ assetPath: m.path }));
}

console.log('=== inspect_asset (scenes) ===');
const scenes = projectOnly(findAssets({ type: 'scene' }).assets);
for (const s of scenes) {
  check(`inspect ${s.path}`, () => inspectAsset({ assetPath: s.path }));
}

console.log('=== ProjectSettings ===');
check('inspect_build_scenes',     () => ps.inspectBuildScenes());
check('inspect_project_settings', () => ps.inspectProjectSettings());
check('inspect_player_settings',  () => ps.inspectPlayerSettings());

console.log();
console.log(`${pass} pass / ${fail} fail`);
if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  ${f.label}\n    ${f.error}`);
  process.exit(1);
}
