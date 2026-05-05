#!/usr/bin/env node
// Visual showcase of the texture / sheet generators.
// Generates ~14 PNGs into DreamerScreenshots/ named showcase-*.png so the
// user can scan a folder and see what each feature produces.
//
//   node daemon/scripts/showcase.js [outDir]

'use strict';

const fs = require('fs');
const path = require('path');
const { renderSpec } = require('../src/texture/render');
const { generateSheet } = require('../src/texture/sheet');

const outDir = process.argv[2] || 'DreamerScreenshots';
fs.mkdirSync(outDir, { recursive: true });

function tex(name, spec) {
  const t0 = Date.now();
  const r = renderSpec(spec);
  const file = path.join(outDir, `showcase-${name}.png`);
  fs.writeFileSync(file, r.png);
  console.log(`${file}  ${r.width}x${r.height}  ${r.png.length}B  ${Date.now() - t0}ms`);
}

function sheet(name, spec) {
  const t0 = Date.now();
  const r = generateSheet(spec);
  const file = path.join(outDir, `showcase-${name}.png`);
  fs.writeFileSync(file, r.png);
  console.log(`${file}  ${r.width}x${r.height}  ${r.cols}x${r.rows}  ${r.png.length}B  ${Date.now() - t0}ms`);
}

// ── Shape catalogue (one of each, in a grid) ────────────────────────

sheet('01-shapes-catalogue', {
  tileSize: [80, 80],
  cols: 3, rows: 2,
  gap: 2,
  background: '#1A1F2A',
  tiles: [
    { background: '#1A1F2A00', layers: [{ type: 'shape', shape: 'circle',  center: [40, 40], radius: 30, fill: '#88BBFF', stroke: { color: '#FFFFFF', width: 2 } }] },
    { background: '#1A1F2A00', layers: [{ type: 'shape', shape: 'rect',    center: [40, 40], size: [55, 55], cornerRadius: 8, rotation: Math.PI / 12, fill: '#FFCC22', stroke: { color: '#FFFFFF', width: 2 } }] },
    { background: '#1A1F2A00', layers: [{ type: 'shape', shape: 'polygon', center: [40, 40], radius: 32, sides: 6, fill: '#FF55AA', stroke: { color: '#FFFFFF', width: 2 } }] },
    { background: '#1A1F2A00', layers: [{ type: 'shape', shape: 'star',    center: [40, 40], outerRadius: 32, innerRadius: 14, points: 5, fill: '#FFD400', stroke: { color: '#1A1A1A', width: 2 } }] },
    { background: '#1A1F2A00', layers: [{ type: 'shape', shape: 'plus',    center: [40, 40], size: 56, thickness: 18, fill: '#22EE88', stroke: { color: '#0A4A2A', width: 2 } }] },
    { background: '#1A1F2A00', layers: [{ type: 'shape', shape: 'line',    from: [12, 12], to: [68, 68], thickness: 8, fill: '#FF7755' }] },
  ],
});

// ── Single-texture game-asset examples ────────────────────────────

// Gold coin: radial gradient + circle + ring + center letter would be nice but no text.
tex('02-coin', {
  size: [128, 128],
  background: '#00000000',
  layers: [
    { type: 'shape', shape: 'circle', center: [64, 64], radius: 58, fill: '#664400', stroke: { color: '#221100', width: 4 } },
    { type: 'shape', shape: 'circle', center: [64, 64], radius: 52, fill: '#FFD400', stroke: { color: '#AA7700', width: 2 } },
    { type: 'shape', shape: 'star',   center: [64, 64], outerRadius: 26, innerRadius: 10, points: 5, fill: '#FFAA00', stroke: { color: '#774400', width: 1 } },
    // Specular highlight: small white-ish circle in upper-left, low alpha.
    { type: 'shape', shape: 'circle', center: [44, 44], radius: 14, fill: '#FFFFFF77' },
  ],
});

// Magic orb: dark base + concentric purple shells fading inward + bright core
// + highlight. Pure-shape composition so nothing bleeds outside the orb.
// (Future: a "mask" / "clip-to-shape" layer would let us put voronoi inside
// the orb. Filed as Phase 6 — the renderer iterates per-pixel so masks are
// a small refactor away from the existing layer loop.)
tex('03-magic-orb', {
  size: [128, 128],
  background: '#00000000',
  layers: [
    { type: 'shape', shape: 'circle', center: [64, 64], radius: 58, fill: '#1A0033', stroke: { color: '#0A0011', width: 3 } },
    { type: 'shape', shape: 'circle', center: [64, 64], radius: 50, fill: '#3311559A' },
    { type: 'shape', shape: 'circle', center: [64, 64], radius: 38, fill: '#664488AA' },
    { type: 'shape', shape: 'circle', center: [64, 64], radius: 26, fill: '#AA88DDCC' },
    { type: 'shape', shape: 'circle', center: [60, 60], radius: 14, fill: '#FFEEFFFF' },
    // Specular crescent.
    { type: 'shape', shape: 'circle', center: [48, 46], radius: 10, fill: '#FFFFFF99' },
    { type: 'shape', shape: 'circle', center: [44, 42], radius: 5,  fill: '#FFFFFFCC' },
  ],
});

// Faceted gem: rotated polygon + lighter inner polygon.
tex('04-gem', {
  size: [128, 128],
  background: '#00000000',
  layers: [
    { type: 'shape', shape: 'polygon', center: [64, 64], radius: 50, sides: 6, rotation: 0, fill: '#22DDFF', stroke: { color: '#003355', width: 3 } },
    { type: 'shape', shape: 'polygon', center: [64, 60], radius: 30, sides: 6, fill: '#88EEFF', stroke: { color: '#22AACC', width: 1 } },
    { type: 'shape', shape: 'polygon', center: [64, 56], radius: 16, sides: 6, fill: '#FFFFFFCC' },
  ],
});

// ── Composite (multi-layer) ──────────────────────────────────────

// "Alien planet": gradient sky + perlin clouds + ground + sun.
tex('05-alien-planet', {
  size: [256, 192],
  layers: [
    { type: 'gradient', kind: 'linear', from: [0, 0], to: [0, 192],
      stops: [
        { offset: 0,   color: '#1A1F4A' },
        { offset: 0.6, color: '#88004A' },
        { offset: 1,   color: '#FF8844' },
      ],
    },
    { type: 'noise', kind: 'perlin', scale: 0.025, octaves: 3, seed: 13,
      color: '#FFFFFF', lo: 0.55, hi: 0.85, blend: 'add', alpha: 0.45 },
    // Sun.
    { type: 'shape', shape: 'circle', center: [200, 60], radius: 26, fill: '#FFEE88', stroke: { color: '#FFAA00', width: 2 } },
    // Ground silhouette: big shallow ellipse (rect with huge corner radius cheats it).
    { type: 'shape', shape: 'rect', center: [128, 220], size: [320, 90], cornerRadius: 45, fill: '#220C18' },
  ],
});

// Comic-book "POW!" style burst — star outline + radial gradient bg.
tex('06-pow-burst', {
  size: [192, 192],
  background: '#FFEE99FF',
  layers: [
    { type: 'gradient', kind: 'radial', from: [96, 96], to: [192, 192],
      stops: [
        { offset: 0, color: '#FFFFFFFF' },
        { offset: 1, color: '#FFEE9900' },
      ],
    },
    { type: 'shape', shape: 'star', center: [96, 96], outerRadius: 80, innerRadius: 40, points: 12, rotation: 0,
      fill: '#FF3322', stroke: { color: '#220011', width: 4 } },
    { type: 'shape', shape: 'star', center: [96, 96], outerRadius: 60, innerRadius: 30, points: 12, rotation: Math.PI / 12,
      fill: '#FFCC22', stroke: { color: '#220011', width: 3 } },
  ],
});

// ── Hand-drawn variants ──────────────────────────────────────────

// Same as 02-coin but with stroke jitter so it looks sketched.
tex('07-handdrawn-coin', {
  size: [128, 128],
  background: '#FFFFFF',
  layers: [
    { type: 'shape', shape: 'circle', center: [64, 64], radius: 50,
      fill: '#FFCC22', stroke: { color: '#221100', width: 3, jitter: { amount: 1.8, scale: 0.2, octaves: 2, seed: 3 } } },
    { type: 'shape', shape: 'star', center: [64, 64], outerRadius: 22, innerRadius: 9, points: 5,
      fill: '#FF8800', stroke: { color: '#221100', width: 2, jitter: { amount: 1.0, scale: 0.25, seed: 6 } } },
  ],
});

// Square that "boils" — every pixel of fill+stroke wobbles together.
tex('08-handdrawn-shape', {
  size: [128, 128],
  background: '#FFFFFF',
  layers: [
    { type: 'shape', shape: 'rect', center: [64, 64], size: [80, 80], cornerRadius: 12,
      fill: '#88BBFF', stroke: { color: '#003366', width: 3 },
      displace: { amount: 4, scale: 0.1, octaves: 2, seed: 17 } },
  ],
});

// ── Noise pattern showcase ───────────────────────────────────────

tex('09-noise-clouds', {
  size: [256, 128],
  background: '#3344AAFF',
  layers: [
    { type: 'noise', kind: 'perlin', scale: 0.018, octaves: 4, persistence: 0.55, seed: 21,
      color: '#FFFFFF', lo: 0.45, hi: 0.85, alpha: 1.0 },
  ],
});

tex('10-noise-stone', {
  size: [128, 128],
  layers: [
    { type: 'noise', kind: 'voronoi', scale: 0.08, metric: 'euclidean', seed: 4, color: '#5A5045' },
    { type: 'noise', kind: 'value', scale: 0.1, octaves: 3, seed: 9, color: '#22150F', blend: 'multiply', alpha: 0.4 },
  ],
});

tex('11-noise-cells-cyan', {
  size: [128, 128],
  layers: [
    { type: 'noise', kind: 'voronoi', scale: 0.18, metric: 'manhattan', seed: 22, color: '#22CCFF' },
  ],
});

// ── Animation sheets (sprite-sheet ready) ────────────────────────

// 4-frame fire flame — yellow→orange, growing then shrinking would need keyframes;
// we go yellow→red, small→big to keep it linear (Phase 4 limitation).
sheet('12-anim-fire', {
  tileSize: [64, 64],
  cols: 4, rows: 1,
  frames: 4,
  background: '#00000000',
  base: {
    layers: [
      { type: 'shape', shape: 'circle', center: [32, 40], radius: 14, fill: '#FFEE00',
        stroke: { color: '#FF8800', width: 2 }, blend: 'normal', alpha: 1.0 },
      { type: 'shape', shape: 'circle', center: [32, 36], radius: 10, fill: '#FFFFAA' },
    ],
  },
  interpolate: {
    'layers[0].radius': [10, 22],
    'layers[0].fill':   ['#FFEE00', '#FF2200'],
    'layers[1].radius': [6, 12],
    'layers[1].center': [[32, 38], [32, 28]],
  },
});

// 4-frame coin spin — width interpolates 100% → 0% → 100% would need keyframes;
// go from 100% to 10% (the second half of the spin can be added later).
sheet('13-anim-coin-spin', {
  tileSize: [64, 64],
  cols: 4, rows: 1,
  frames: 4,
  background: '#00000000',
  base: {
    layers: [
      { type: 'shape', shape: 'rect', center: [32, 32], size: [50, 50], cornerRadius: 25,
        fill: '#FFD400', stroke: { color: '#AA7700', width: 3 } },
      { type: 'shape', shape: 'star', center: [32, 32], outerRadius: 16, innerRadius: 7, points: 5,
        fill: '#FFAA00', stroke: { color: '#774400', width: 1 } },
    ],
  },
  interpolate: {
    'layers[0].size': [[50, 50], [8, 50]],
    'layers[1].outerRadius': [16, 2],
    'layers[1].innerRadius': [7, 1],
  },
});

// 4-frame growing star with hand-drawn outline — combines sheet animation +
// stroke jitter + color interpolation. The "complete the loop" demo.
sheet('14-anim-handdrawn-twinkle', {
  tileSize: [64, 64],
  cols: 4, rows: 1,
  frames: 4,
  background: '#FFFFFFFF',
  base: {
    layers: [
      { type: 'shape', shape: 'star', center: [32, 32], outerRadius: 8, innerRadius: 3, points: 5,
        fill: '#FFD400',
        stroke: { color: '#221100', width: 2, jitter: { amount: 1.0, scale: 0.25, seed: 31 } } },
    ],
  },
  interpolate: {
    'layers[0].outerRadius': [8, 26],
    'layers[0].innerRadius': [3, 12],
    'layers[0].fill':        ['#FFFFAA', '#FF8800'],
  },
});
