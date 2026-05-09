#!/usr/bin/env node
// Parse every Unity YAML file under Assets/, ProjectSettings/, Packages/ and
// report any failures. Run before changing the parser to confirm baseline +
// catch regressions.

'use strict';

const fs = require('fs');
const path = require('path');
const { parseUnityYaml } = require('../src/unity-yaml/parse');

const EXTS = new Set([
  '.prefab', '.unity', '.asset', '.mat', '.anim', '.controller',
  '.physicMaterial', '.physicsMaterial2D', '.mask', '.overrideController',
  '.preset', '.spriteatlas', '.lighting', '.guiskin', '.fontsettings',
  '.cubemap', '.flare',
]);

const WALK_ROOTS = ['Assets', 'ProjectSettings', 'Packages'];

const root = path.resolve(__dirname, '..', '..');
let total = 0, ok = 0, failures = [];

function walk(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return; }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      walk(full);
    } else {
      const ext = path.extname(e.name).toLowerCase();
      if (!EXTS.has(ext) && !(dir.endsWith('ProjectSettings') && ext === '.asset')) continue;
      total++;
      const rel = path.relative(root, full).replace(/\\/g, '/');
      let text;
      try { text = fs.readFileSync(full, 'utf8'); }
      catch (err) { failures.push({ file: rel, error: 'read: ' + err.message }); continue; }
      // Skip non-YAML serialization mode (binary). They start with bytes that aren't `%YAML`.
      if (!text.startsWith('%YAML') && !text.startsWith('---')) continue;
      try {
        const docs = parseUnityYaml(text);
        if (docs.length === 0) {
          failures.push({ file: rel, error: 'no documents parsed' });
          continue;
        }
        ok++;
      } catch (err) {
        failures.push({ file: rel, error: err.message });
      }
    }
  }
}

for (const r of WALK_ROOTS) walk(path.join(root, r));

console.log(`Parsed ${ok}/${total} YAML asset files.`);
if (failures.length) {
  console.log(`\nFailures (${failures.length}):`);
  for (const f of failures) console.log(`  ${f.file}\n    ${f.error}`);
  process.exit(1);
}
process.exit(0);
