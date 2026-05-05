'use strict';

// RGBA raster buffer + alpha-blending helpers.
// Storage: Uint8ClampedArray of length w*h*4, row-major, top-to-bottom,
// channels in R-G-B-A order. Top-to-bottom matches PNG scanline order so we
// can pass the buffer straight to png.js without flipping.

class Raster {
  constructor(width, height) {
    this.width = width | 0;
    this.height = height | 0;
    this.data = new Uint8ClampedArray(width * height * 4);
  }

  /** Fill the whole buffer with a single RGBA color (0-255 each). */
  clear(r, g, b, a) {
    const d = this.data;
    for (let i = 0; i < d.length; i += 4) {
      d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = a;
    }
  }

  /** Get pixel index for (x, y), or -1 if out of bounds. */
  idx(x, y) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return -1;
    return (y * this.width + x) * 4;
  }

  /**
   * Blend a source RGBA color onto pixel (x, y) using "normal" (alpha-over).
   * Source alpha 0 = no-op; source alpha 1 = overwrite.
   */
  blendNormal(x, y, r, g, b, a) {
    if (a === 0) return;
    const i = this.idx(x, y); if (i < 0) return;
    const d = this.data;
    if (a === 255) { d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255; return; }
    // Standard alpha-over with straight (non-premultiplied) src/dst.
    const sa = a / 255;
    const da = d[i + 3] / 255;
    const oa = sa + da * (1 - sa);
    if (oa <= 0) { d[i] = 0; d[i + 1] = 0; d[i + 2] = 0; d[i + 3] = 0; return; }
    d[i]     = (r * sa + d[i]     * da * (1 - sa)) / oa | 0;
    d[i + 1] = (g * sa + d[i + 1] * da * (1 - sa)) / oa | 0;
    d[i + 2] = (b * sa + d[i + 2] * da * (1 - sa)) / oa | 0;
    d[i + 3] = (oa * 255) | 0;
  }

  /** Additive blend: out = clamp(src*src.a + dst). Common for fire/sparks. */
  blendAdd(x, y, r, g, b, a) {
    if (a === 0) return;
    const i = this.idx(x, y); if (i < 0) return;
    const d = this.data;
    const sa = a / 255;
    d[i]     = Math.min(255, d[i]     + r * sa);
    d[i + 1] = Math.min(255, d[i + 1] + g * sa);
    d[i + 2] = Math.min(255, d[i + 2] + b * sa);
    d[i + 3] = Math.min(255, d[i + 3] + a);
  }

  /** Multiply blend: out = src*dst/255 (per channel). */
  blendMultiply(x, y, r, g, b, a) {
    if (a === 0) return;
    const i = this.idx(x, y); if (i < 0) return;
    const d = this.data;
    const sa = a / 255;
    d[i]     = (d[i]     * (r * sa + (1 - sa) * 255)) / 255 | 0;
    d[i + 1] = (d[i + 1] * (g * sa + (1 - sa) * 255)) / 255 | 0;
    d[i + 2] = (d[i + 2] * (b * sa + (1 - sa) * 255)) / 255 | 0;
    // Alpha unchanged on multiply.
  }

  blend(mode, x, y, r, g, b, a) {
    switch (mode) {
      case 'add':       return this.blendAdd(x, y, r, g, b, a);
      case 'multiply':  return this.blendMultiply(x, y, r, g, b, a);
      case 'normal':
      default:          return this.blendNormal(x, y, r, g, b, a);
    }
  }
}

// ── Color parsing ─────────────────────────────────────────────────

/**
 * Parse a color spec into [r, g, b, a] (0-255 each).
 * Accepts: "#RRGGBB", "#RRGGBBAA", "#RGB" (CSS shorthand expanded),
 * or { r, g, b, a } object with 0-1 floats.
 */
function parseColor(spec) {
  if (Array.isArray(spec) && spec.length >= 3) {
    return [
      clamp255(spec[0]), clamp255(spec[1]), clamp255(spec[2]),
      spec.length >= 4 ? clamp255(spec[3]) : 255,
    ];
  }
  if (typeof spec === 'object' && spec !== null) {
    return [
      Math.round((spec.r ?? 0) * 255),
      Math.round((spec.g ?? 0) * 255),
      Math.round((spec.b ?? 0) * 255),
      Math.round((spec.a ?? 1) * 255),
    ];
  }
  if (typeof spec !== 'string') throw new Error(`parseColor: unsupported type for ${JSON.stringify(spec)}`);
  let s = spec.trim();
  if (s.startsWith('#')) s = s.slice(1);
  if (s.length === 3) s = s.split('').map((c) => c + c).join('') + 'FF';
  if (s.length === 4) s = s.split('').map((c) => c + c).join('');
  if (s.length === 6) s += 'FF';
  if (s.length !== 8) throw new Error(`parseColor: bad hex "${spec}" (need #RGB, #RGBA, #RRGGBB, or #RRGGBBAA)`);
  const n = parseInt(s, 16);
  if (Number.isNaN(n)) throw new Error(`parseColor: invalid hex "${spec}"`);
  return [(n >>> 24) & 0xFF, (n >>> 16) & 0xFF, (n >>> 8) & 0xFF, n & 0xFF];
}

function clamp255(v) {
  v = +v; if (!Number.isFinite(v)) v = 0;
  v = v > 1 ? v : v * 255;
  return Math.max(0, Math.min(255, Math.round(v)));
}

module.exports = { Raster, parseColor };
