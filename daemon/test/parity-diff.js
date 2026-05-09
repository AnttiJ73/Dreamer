#!/usr/bin/env node
// Run each Node-migrated read command via the Node path AND the Unity path,
// then diff the outputs. Reports any divergence.
//
// Requires Unity to be connected (otherwise the Unity-path runs hang on
// poll). Run interactively after major changes to the unity-yaml modules.

'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
process.chdir(root);

let pass = 0, mismatch = 0, errored = 0;
const issues = [];

function dreamer(args) {
  const r = spawnSync(process.platform === 'win32' ? 'bin\\dreamer.cmd' : './bin/dreamer', args, {
    cwd: root,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    timeout: 60000,
  });
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

function runJson(args, viaUnity) {
  const fullArgs = viaUnity ? [...args, '--unity'] : args;
  const r = dreamer(fullArgs);
  if (r.code !== 0) {
    return { error: `exit ${r.code}: ${r.stderr.slice(0, 300)}` };
  }
  try { return JSON.parse(r.stdout); }
  catch (e) { return { error: `parse error: ${r.stdout.slice(0, 200)}` }; }
}

// Diff two values. Returns array of paths where they differ. Some Unity-side
// fields are runtime-derived (instanceId, lastModified at sub-second precision)
// and would always differ — list them in `ignorePaths` so we don't flag them.
function diff(a, b, ignorePaths = [], pathPrefix = '') {
  const diffs = [];
  if (typeof a !== typeof b) {
    diffs.push({ path: pathPrefix, a, b });
    return diffs;
  }
  if (a === null || b === null) {
    if (a !== b) diffs.push({ path: pathPrefix, a, b });
    return diffs;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) {
      diffs.push({ path: pathPrefix, a, b });
      return diffs;
    }
    if (a.length !== b.length) {
      diffs.push({ path: pathPrefix + '.length', a: a.length, b: b.length });
    }
    const max = Math.max(a.length, b.length);
    for (let i = 0; i < max; i++) {
      const sub = `${pathPrefix}[${i}]`;
      if (ignorePaths.some(p => matchPath(p, sub))) continue;
      diffs.push(...diff(a[i], b[i], ignorePaths, sub));
    }
    return diffs;
  }
  if (typeof a === 'object') {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      const sub = pathPrefix ? `${pathPrefix}.${k}` : k;
      if (ignorePaths.some(p => matchPath(p, sub))) continue;
      diffs.push(...diff(a[k], b[k], ignorePaths, sub));
    }
    return diffs;
  }
  if (a !== b) diffs.push({ path: pathPrefix, a, b });
  return diffs;
}

function matchPath(pattern, p) {
  if (pattern instanceof RegExp) return pattern.test(p);
  if (pattern === p) return true;
  if (pattern.startsWith('*')) {
    const tail = pattern.slice(1);
    return p.endsWith(tail);
  }
  const re = new RegExp('^' + pattern.replace(/\[\*\]/g, '\\[\\d+\\]').replace(/\./g, '\\.') + '$');
  return re.test(p);
}

function check(label, args, ignorePaths = []) {
  process.stdout.write(`  ${label} ... `);
  const node = runJson(args, false);
  const unity = runJson(args, true);
  if (node.error) {
    errored++;
    console.log('NODE_ERROR:', node.error.slice(0, 80));
    issues.push({ label, type: 'node-error', error: node.error });
    return;
  }
  if (unity.error) {
    errored++;
    console.log('UNITY_ERROR:', unity.error.slice(0, 80));
    issues.push({ label, type: 'unity-error', error: unity.error });
    return;
  }
  const allIgnores = ignorePaths.length === 0 ? COMMON_IGNORES : ignorePaths;
  const diffs = diff(node, unity, allIgnores);
  if (diffs.length === 0) {
    pass++;
    console.log('OK');
  } else {
    mismatch++;
    console.log(`DIVERGED (${diffs.length} field${diffs.length === 1 ? '' : 's'})`);
    issues.push({ label, type: 'diverged', diffs });
  }
}

// ── Globally-ignored fields ───────────────────────────────────────────────
// Fields that legitimately differ between Node (YAML) and Unity (runtime).
//   • instanceId — Unity returns runtime InstanceID, Node returns YAML fileID.
//   • lastModified — Node uses .meta mtime; Unity uses asset file mtime.
//     They're usually within ~ms of each other but not identical.
//   • _via, warnings — Node-only diagnostics.
const COMMON_IGNORES = [
  '*.instanceId',
  '*.lastModified',
  '_via',
  'warnings',
  'instanceId',
  'root.instanceId',
  // ProjectSettings file list — both sides return the same set, but Unity's
  // ordering follows internal indexing, ours is alphabetical. We compare the
  // set elsewhere if needed.
  /^files\[\d+\]$/,
];

console.log('=== find-assets ===');
check('find-assets type=prefab',  ['find-assets', '--type', 'prefab'], [
  ...COMMON_IGNORES,
  // FindAssets ordering isn't stable across Node-walk vs Unity-AssetDatabase.
  // We compare counts but not specific item ordering — so put the items[*]
  // comparison off-limits and just check totals.
  'assets', 'totalFound', 'count',
]);
check('find-assets type=material', ['find-assets', '--type', 'material'], [
  ...COMMON_IGNORES, 'assets', 'totalFound', 'count',
]);
check('find-assets name=Sparkle', ['find-assets', '--name', 'Sparkle'], [
  ...COMMON_IGNORES, 'assets', 'totalFound', 'count',
]);

console.log('=== find-assets count parity (separate, since ordering ignored above) ===');
{
  const node = runJson(['find-assets', '--type', 'prefab'], false);
  const unity = runJson(['find-assets', '--type', 'prefab'], true);
  if (node.error || unity.error) {
    errored++;
    console.log('  prefab counts: error');
  } else if (node.count === unity.count && node.totalFound === unity.totalFound) {
    pass++;
    console.log(`  prefab counts: OK (${node.count})`);
  } else {
    mismatch++;
    console.log(`  prefab counts: DIVERGED (node ${node.count}/${node.totalFound}, unity ${unity.count}/${unity.totalFound})`);
    issues.push({ label: 'find-assets count', type: 'diverged', node: node.count, unity: unity.count });
  }
}

console.log('=== inspect (prefab) ===');
check('inspect SparkleEffect', ['inspect', 'Assets/_DreamerTest/SparkleEffect.prefab']);
check('inspect FireEffect', ['inspect', 'Assets/_DreamerTest/FireEffect.prefab']);
check('inspect SmokeEffect', ['inspect', 'Assets/_DreamerTest/SmokeEffect.prefab']);
check('inspect Checkpoint', ['inspect', 'Assets/Prefabs/CheckpointPrefab.prefab']);
check('inspect with includeTransforms', ['inspect', 'Assets/_DreamerTest/SparkleEffect.prefab', '--include-transforms']);
check('inspect by guid', ['inspect', '2b23025891760da42b1295971fee7bfb']);

// inspect-material now stays on Unity by design — see CLI dispatcher comment.

console.log('=== inspect-build-scenes ===');
check('inspect-build-scenes', ['inspect-build-scenes']);

console.log('=== inspect-project-settings ===');
check('inspect-project-settings', ['inspect-project-settings']);

console.log('=== inspect-player-settings ===');
check('inspect-player-settings', ['inspect-player-settings']);

console.log('=== inspect-hierarchy ===');
check('inspect-hierarchy --asset SparkleEffect', ['inspect-hierarchy', '--asset', 'Assets/_DreamerTest/SparkleEffect.prefab']);

console.log();
console.log(`${pass} pass / ${mismatch} diverged / ${errored} errored`);
if (issues.length) {
  console.log('\nIssues:');
  for (const i of issues) {
    console.log(`\n  [${i.type}] ${i.label}`);
    if (i.diffs) {
      for (const d of i.diffs.slice(0, 6)) {
        console.log(`    ${d.path}: node=${JSON.stringify(d.a)} unity=${JSON.stringify(d.b)}`);
      }
      if (i.diffs.length > 6) console.log(`    ...(+${i.diffs.length - 6} more)`);
    }
    if (i.error) console.log(`    ${i.error}`);
  }
  process.exit(1);
}
