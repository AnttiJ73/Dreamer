#!/usr/bin/env node
// Smoke test for the texture renderer. Generates four sample PNGs to
// /tmp-style location so we can eyeball them without bothering Unity.
//
//   node daemon/scripts/texture-smoke.js [outDir]

'use strict';

const fs = require('fs');
const path = require('path');
const { renderSpec } = require('../src/texture/render');

const outDir = process.argv[2] || 'DreamerScreenshots';
fs.mkdirSync(outDir, { recursive: true });

function write(name, spec) {
  const t0 = Date.now();
  const { png, width, height } = renderSpec(spec);
  const file = path.join(outDir, name);
  fs.writeFileSync(file, png);
  console.log(`${file}  ${width}x${height}  ${png.length} bytes  ${Date.now() - t0}ms`);
}

// 1. Solid orange circle on transparent.
write('texgen-circle-aa.png', {
  size: [128, 128],
  background: '#00000000',
  layers: [
    {
      type: 'shape', shape: 'circle',
      center: [64, 64], radius: 50,
      fill: '#FF8800',
      stroke: { color: '#000000', width: 4 },
    },
  ],
});

// 2. Star with outline.
write('texgen-star.png', {
  size: [128, 128],
  background: '#22223388',
  layers: [
    {
      type: 'shape', shape: 'star',
      center: [64, 64], outerRadius: 55, innerRadius: 22, points: 5,
      fill: '#FFD400',
      stroke: { color: '#1A1A1A', width: 3 },
    },
  ],
});

// 3. Linear gradient + circle on top + value noise.
write('texgen-composite.png', {
  size: [256, 256],
  layers: [
    {
      type: 'gradient', kind: 'linear',
      from: [0, 0], to: [256, 256],
      stops: [
        { offset: 0, color: '#1A1F4A' },
        { offset: 1, color: '#88004A' },
      ],
    },
    {
      type: 'noise', kind: 'value',
      scale: 0.04, octaves: 3, persistence: 0.55,
      color: '#FFFFFF', lo: 0.4, hi: 0.7, blend: 'add', alpha: 0.6, seed: 7,
    },
    {
      type: 'shape', shape: 'circle',
      center: [128, 128], radius: 60,
      fill: '#FFCC22',
      stroke: { color: '#220011', width: 4 },
      blend: 'normal',
    },
  ],
});

// 4. Voronoi background with rounded square punched on top.
write('texgen-voronoi.png', {
  size: [128, 128],
  layers: [
    {
      type: 'noise', kind: 'voronoi', scale: 0.18, seed: 42,
      color: '#A0E0FF',
    },
    {
      type: 'shape', shape: 'rect',
      center: [64, 64], size: [80, 80], cornerRadius: 16, rotation: Math.PI / 12,
      fill: '#222222CC',
      stroke: { color: '#FFFFFF', width: 2 },
    },
  ],
});
