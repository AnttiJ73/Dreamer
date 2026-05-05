'use strict';

// Procedural noise generators. All return a function (x, y) => value in [0, 1]
// (approximately — value/perlin can range slightly outside, the renderer
// clamps via lo/hi). Deterministic given the same seed.

function makeNoise(spec) {
  const kind = spec.kind || 'value';
  const scale = spec.scale != null ? spec.scale : 0.05;
  const seed = spec.seed != null ? spec.seed | 0 : 1337;
  switch (kind) {
    case 'white':   return makeWhite(seed);
    case 'value':   return makeValue(seed, scale, spec.octaves || 1, spec.persistence || 0.5);
    case 'perlin':  return makePerlin(seed, scale, spec.octaves || 1, spec.persistence || 0.5);
    case 'voronoi': return makeVoronoi(seed, scale, spec.metric || 'euclidean');
    default: throw new Error(`Unknown noise kind: ${kind}`);
  }
}

// ── Hash + RNG ────────────────────────────────────────────────────

// Mulberry32 — small fast PRNG, deterministic from seed.
function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Spatial hash → [0, 1]. Used for grid-cell-keyed values.
function hash2(x, y, seed) {
  let h = (x | 0) * 374761393 + (y | 0) * 668265263 + (seed | 0) * 982451653;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

// ── Noise implementations ────────────────────────────────────────

function makeWhite(seed) {
  return (x, y) => hash2(x | 0, y | 0, seed);
}

function makeValue(seed, scale, octaves, persistence) {
  return (x, y) => {
    let amp = 1, freq = 1, sum = 0, ampSum = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * valueOctave(x * scale * freq, y * scale * freq, seed + o);
      ampSum += amp;
      amp *= persistence;
      freq *= 2;
    }
    return sum / ampSum;
  };
}

function valueOctave(x, y, seed) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const tx = x - x0, ty = y - y0;
  const sx = smooth(tx), sy = smooth(ty);
  const v00 = hash2(x0,     y0,     seed);
  const v10 = hash2(x0 + 1, y0,     seed);
  const v01 = hash2(x0,     y0 + 1, seed);
  const v11 = hash2(x0 + 1, y0 + 1, seed);
  return lerp(lerp(v00, v10, sx), lerp(v01, v11, sx), sy);
}

function makePerlin(seed, scale, octaves, persistence) {
  return (x, y) => {
    let amp = 1, freq = 1, sum = 0, ampSum = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * perlinOctave(x * scale * freq, y * scale * freq, seed + o);
      ampSum += amp;
      amp *= persistence;
      freq *= 2;
    }
    // Perlin output is roughly in [-0.7, +0.7]. Remap to [0, 1].
    return Math.max(0, Math.min(1, (sum / ampSum) * 0.7 + 0.5));
  };
}

function perlinOctave(x, y, seed) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const tx = x - x0, ty = y - y0;
  const u = fade(tx), v = fade(ty);
  const g00 = grad(hash2(x0,     y0,     seed), tx,     ty);
  const g10 = grad(hash2(x0 + 1, y0,     seed), tx - 1, ty);
  const g01 = grad(hash2(x0,     y0 + 1, seed), tx,     ty - 1);
  const g11 = grad(hash2(x0 + 1, y0 + 1, seed), tx - 1, ty - 1);
  return lerp(lerp(g00, g10, u), lerp(g01, g11, u), v);
}

function makeVoronoi(seed, scale, metric) {
  // Cellular noise — for each pixel, find the nearest jittered point in the
  // 3×3 surrounding grid cells. Returns the F1 (nearest) distance, normalized
  // to [0, 1] by the cell-size diagonal so output stays in range regardless
  // of `scale`.
  const distFn = metric === 'manhattan'
    ? (a, b) => Math.abs(a) + Math.abs(b)
    : metric === 'chebyshev'
      ? (a, b) => Math.max(Math.abs(a), Math.abs(b))
      : (a, b) => Math.hypot(a, b);
  return (x, y) => {
    const sx = x * scale, sy = y * scale;
    const cx = Math.floor(sx), cy = Math.floor(sy);
    let best = Infinity;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const gx = cx + dx, gy = cy + dy;
        const jx = gx + hash2(gx, gy, seed);
        const jy = gy + hash2(gx, gy, seed + 17);
        const d = distFn(sx - jx, sy - jy);
        if (d < best) best = d;
      }
    }
    return Math.max(0, Math.min(1, best / 1.5));
  };
}

// ── helpers ──────────────────────────────────────────────────────

function smooth(t) { return t * t * (3 - 2 * t); }
function fade(t)   { return t * t * t * (t * (t * 6 - 15) + 10); }
function lerp(a, b, t) { return a + (b - a) * t; }
function grad(h, dx, dy) {
  // 8-direction gradient table indexed by 3 bits of the hash.
  const g = (h * 8) | 0;
  switch (g & 7) {
    case 0: return  dx + dy;
    case 1: return  dx - dy;
    case 2: return -dx + dy;
    case 3: return -dx - dy;
    case 4: return  dx;
    case 5: return -dx;
    case 6: return  dy;
    case 7: return -dy;
  }
  return 0;
}

module.exports = { makeNoise, mulberry32, hash2 };
