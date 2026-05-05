'use strict';

// Sheet builder. Composes N tile renders into a grid PNG.
// Two modes:
//   1. Explicit tiles: `tiles: [tileSpec, tileSpec, ...]` — each spec is
//      rendered at tileSize and pasted at its grid position.
//   2. Animation: `base: tileSpec`, `frames: N`, `interpolate: { path: [start, end] }`
//      — clones the base, walks the path, interpolates the value across frames.
//
// Sheet spec format:
//   {
//     tileSize: [W, H],         // px per tile
//     cols, rows: ints,         // grid dimensions
//     background?: color,
//     gap?: int,                // px between tiles, default 0
//     tiles?: [tileSpec, ...]   // explicit mode
//     // OR
//     frames?: int,             // animation mode total tile count (defaults to cols*rows)
//     base?: tileSpec,          // animation mode base spec
//     interpolate?: { "layers[0].radius": [5, 30], ... }
//   }

const { Raster, parseColor } = require('./raster');
const { renderSpec } = require('./render');
const { encodePNG } = require('./png');

function generateSheet(sheetSpec) {
  if (!Array.isArray(sheetSpec.tileSize) || sheetSpec.tileSize.length !== 2)
    throw new Error('sheet.tileSize must be [width, height]');
  const cols = Math.max(1, sheetSpec.cols | 0);
  const rows = Math.max(1, sheetSpec.rows | 0);
  const [tw, th] = sheetSpec.tileSize.map((n) => n | 0);
  const gap = Math.max(0, sheetSpec.gap | 0);
  const sheetW = cols * tw + (cols + 1) * gap;
  const sheetH = rows * th + (rows + 1) * gap;
  if (sheetW > 8192 || sheetH > 8192)
    throw new Error(`sheet too large: ${sheetW}x${sheetH} (max 8192 per axis)`);

  const tileSpecs = expandTileSpecs(sheetSpec);
  const N = Math.min(tileSpecs.length, cols * rows);

  const sheet = new Raster(sheetW, sheetH);
  if (sheetSpec.background != null) {
    const [r, g, b, a] = parseColor(sheetSpec.background);
    sheet.clear(r, g, b, a);
  }

  const tileMeta = [];
  for (let i = 0; i < N; i++) {
    const col = i % cols;
    const row = (i / cols) | 0;
    const tileSpec = { ...tileSpecs[i], size: [tw, th] };
    const rendered = renderSpec(tileSpec);
    const x0 = gap + col * (tw + gap);
    const y0 = gap + row * (th + gap);
    blitRGBA(sheet, rendered.rgba, tw, th, x0, y0);
    tileMeta.push({ index: i, col, row, x: x0, y: y0, w: tw, h: th });
  }

  const png = encodePNG(sheet.data, sheetW, sheetH);
  return {
    png,
    width: sheetW,
    height: sheetH,
    cols, rows,
    tileWidth: tw, tileHeight: th,
    tileCount: N,
    tiles: tileMeta,
  };
}

function expandTileSpecs(sheetSpec) {
  if (Array.isArray(sheetSpec.tiles) && sheetSpec.tiles.length > 0) {
    return sheetSpec.tiles;
  }
  if (sheetSpec.base) {
    const frames = Math.max(1, (sheetSpec.frames | 0) || (sheetSpec.cols * sheetSpec.rows));
    const interp = sheetSpec.interpolate || {};
    const out = [];
    for (let i = 0; i < frames; i++) {
      const t = frames > 1 ? i / (frames - 1) : 0;
      const tileSpec = deepClone(sheetSpec.base);
      for (const [path, range] of Object.entries(interp)) {
        const v = interpolateValue(range, t);
        setByPath(tileSpec, path, v);
      }
      out.push(tileSpec);
    }
    return out;
  }
  throw new Error('sheet spec needs either `tiles` (explicit list) or `base` (animation mode)');
}

// Numbers interpolate linearly. Colors (#RRGGBB / #RRGGBBAA / arrays) interpolate
// channel-wise. Anything else: only the start value is used (range[0]).
function interpolateValue(range, t) {
  if (!Array.isArray(range) || range.length < 2) return range[0];
  const a = range[0], b = range[1];
  if (typeof a === 'number' && typeof b === 'number') return a + (b - a) * t;
  if (typeof a === 'string' && typeof b === 'string' && a.startsWith('#') && b.startsWith('#')) {
    const ca = parseColor(a), cb = parseColor(b);
    const r = Math.round(ca[0] + (cb[0] - ca[0]) * t);
    const g = Math.round(ca[1] + (cb[1] - ca[1]) * t);
    const bb = Math.round(ca[2] + (cb[2] - ca[2]) * t);
    const aa = Math.round(ca[3] + (cb[3] - ca[3]) * t);
    return '#' + [r, g, bb, aa].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
  }
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) {
    return a.map((va, i) => typeof va === 'number' && typeof b[i] === 'number' ? va + (b[i] - va) * t : va);
  }
  return a;
}

// Walk a property path like "layers[0].radius" or "layers[2].center[1]" and
// set the leaf value. Creates intermediate keys if missing — but we generally
// want this to fail loudly for typos (the user just made a 16-tile sheet
// that ignored their interpolation), so we throw on missing array indices.
function setByPath(obj, path, value) {
  const tokens = parsePath(path);
  let cur = obj;
  for (let i = 0; i < tokens.length - 1; i++) {
    const tok = tokens[i];
    if (cur[tok] == null) throw new Error(`interpolate path "${path}" failed at "${tok}" — does the base spec have it?`);
    cur = cur[tok];
  }
  cur[tokens[tokens.length - 1]] = value;
}

function parsePath(path) {
  const out = [];
  let buf = '';
  for (let i = 0; i < path.length; i++) {
    const c = path[i];
    if (c === '.') { if (buf) { out.push(buf); buf = ''; } }
    else if (c === '[') {
      if (buf) { out.push(buf); buf = ''; }
      const end = path.indexOf(']', i);
      if (end < 0) throw new Error(`unterminated [ in path: ${path}`);
      out.push(parseInt(path.slice(i + 1, end), 10));
      i = end;
    } else buf += c;
  }
  if (buf) out.push(buf);
  return out;
}

function deepClone(o) {
  return JSON.parse(JSON.stringify(o));
}

// Paste a tile's RGBA buffer into the sheet at (x0, y0) using normal blend.
// `src` is row-major top-to-bottom RGBA, length = w*h*4.
function blitRGBA(sheet, src, w, h, x0, y0) {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const si = (y * w + x) * 4;
      sheet.blendNormal(x0 + x, y0 + y, src[si], src[si + 1], src[si + 2], src[si + 3]);
    }
  }
}

module.exports = { generateSheet, setByPath, parsePath };
