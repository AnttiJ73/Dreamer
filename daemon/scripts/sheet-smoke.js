#!/usr/bin/env node
// Smoke test for the sheet builder + stroke jitter.
//
//   node daemon/scripts/sheet-smoke.js [outDir]

'use strict';

const fs = require('fs');
const path = require('path');
const { generateSheet } = require('../src/texture/sheet');
const { renderSpec } = require('../src/texture/render');

const outDir = process.argv[2] || 'DreamerScreenshots';
fs.mkdirSync(outDir, { recursive: true });

function writeSheet(name, sheetSpec) {
  const t0 = Date.now();
  const r = generateSheet(sheetSpec);
  const file = path.join(outDir, name);
  fs.writeFileSync(file, r.png);
  console.log(`${file}  ${r.width}x${r.height}  ${r.cols}x${r.rows} tiles  ${r.png.length} bytes  ${Date.now() - t0}ms`);
}

function writeTex(name, spec) {
  const t0 = Date.now();
  const r = renderSpec(spec);
  const file = path.join(outDir, name);
  fs.writeFileSync(file, r.png);
  console.log(`${file}  ${r.width}x${r.height}  ${r.png.length} bytes  ${Date.now() - t0}ms`);
}

// 1. Animated puff: 4 frames, 2×2 grid, radius grows + color shifts yellow→red.
writeSheet('sheet-puff.png', {
  tileSize: [64, 64],
  cols: 2, rows: 2,
  frames: 4,
  background: '#00000000',
  base: {
    layers: [
      {
        type: 'shape', shape: 'circle',
        center: [32, 32], radius: 5,
        fill: '#FFEE00',
        stroke: { color: '#222222', width: 2 },
        alpha: 1.0,
      },
    ],
  },
  interpolate: {
    'layers[0].radius': [5, 25],
    'layers[0].fill': ['#FFEE00', '#FF2200'],
    'layers[0].alpha': [1.0, 0.4],
  },
});

// 2. Explicit-tile mode: row of 4 different shapes for an icon strip.
writeSheet('sheet-icons.png', {
  tileSize: [48, 48],
  cols: 4, rows: 1,
  gap: 2,
  background: '#22223388',
  tiles: [
    { background: '#22223300', layers: [{ type: 'shape', shape: 'circle',  center: [24, 24], radius: 18, fill: '#88BBFF', stroke: { color: '#FFFFFF', width: 2 } }] },
    { background: '#22223300', layers: [{ type: 'shape', shape: 'star',    center: [24, 24], outerRadius: 20, innerRadius: 8, points: 5, fill: '#FFD400', stroke: { color: '#1A1A1A', width: 2 } }] },
    { background: '#22223300', layers: [{ type: 'shape', shape: 'plus',    center: [24, 24], size: 36, thickness: 10, fill: '#22EE88' }] },
    { background: '#22223300', layers: [{ type: 'shape', shape: 'polygon', center: [24, 24], radius: 20, sides: 6, fill: '#FF55AA', stroke: { color: '#FFFFFF', width: 2 } }] },
  ],
});

// 3. Stroke jitter — circle with a hand-drawn-looking outline.
writeTex('jitter-circle.png', {
  size: [128, 128],
  background: '#FFFFFFFF',
  layers: [
    {
      type: 'shape', shape: 'circle',
      center: [64, 64], radius: 45,
      fill: '#88BBFF',
      stroke: { color: '#1A1A1A', width: 3, jitter: { amount: 2.5, scale: 0.18, octaves: 2, seed: 9 } },
    },
  ],
});

// 4. Whole-shape displacement — wobbly square (everything boils together).
writeTex('jitter-square.png', {
  size: [128, 128],
  background: '#FFFFFFFF',
  layers: [
    {
      type: 'shape', shape: 'rect',
      center: [64, 64], size: [80, 80],
      fill: '#FFCC22',
      stroke: { color: '#332200', width: 3 },
      displace: { amount: 4, scale: 0.12, octaves: 2, seed: 4 },
    },
  ],
});

// 5. Animated growing star with both fill-displace and stroke-jitter (full hand-drawn).
writeSheet('sheet-handdrawn-puff.png', {
  tileSize: [64, 64],
  cols: 4, rows: 1,
  frames: 4,
  background: '#FFFFFFFF',
  base: {
    layers: [
      {
        type: 'shape', shape: 'star',
        center: [32, 32], outerRadius: 8, innerRadius: 3, points: 5,
        fill: '#FFAA22',
        stroke: { color: '#221100', width: 2, jitter: { amount: 1.2, scale: 0.2, seed: 11 } },
        displace: { amount: 1.5, scale: 0.18, seed: 5 },
      },
    ],
  },
  interpolate: {
    'layers[0].outerRadius': [8, 26],
    'layers[0].innerRadius': [3, 12],
  },
});
