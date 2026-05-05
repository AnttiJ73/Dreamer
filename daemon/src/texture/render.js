'use strict';

// Spec-driven texture compositor. Takes a JSON spec with `size` and `layers`,
// rasterizes each layer in order onto an RGBA buffer, and returns a PNG.
//
// Spec shape (informal):
//   {
//     size: [W, H],
//     background: "#RRGGBBAA" | null,
//     layers: [
//       { type: 'solid', color: "#FF0000", blend?, alpha? },
//       { type: 'gradient', kind: 'linear'|'radial', from: [x,y], to: [x,y],
//         stops: [{ offset: 0..1, color }], blend?, alpha? },
//       { type: 'shape', shape: 'circle'|'rect'|'polygon'|'star'|'plus'|'line',
//         /* shape-specific args: center, radius, size, sides, ... */
//         fill?: "color", stroke?: { color, width, position?: 'centered'|'outside'|'inside' },
//         antialias?: true, blend?, alpha?, mask?: { /* another layer */ } },
//       { type: 'noise', kind: 'value'|'perlin', scale: 0.05, seed?: 1, ... }
//     ]
//   }

const { Raster, parseColor } = require('./raster');
const { makeShape } = require('./shapes');
const { encodePNG } = require('./png');
const { makeNoise } = require('./noise');

function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function renderSpec(spec) {
  if (!spec || !Array.isArray(spec.size) || spec.size.length !== 2)
    throw new Error('spec.size must be [width, height]');
  const [w, h] = spec.size.map((n) => n | 0);
  if (w <= 0 || h <= 0 || w > 8192 || h > 8192)
    throw new Error(`size out of range: ${w}x${h} (allowed 1..8192)`);

  const raster = new Raster(w, h);

  // Background.
  if (spec.background != null) {
    const [r, g, b, a] = parseColor(spec.background);
    raster.clear(r, g, b, a);
  }

  for (const layer of spec.layers || []) {
    renderLayer(raster, layer);
  }

  return {
    width: w,
    height: h,
    rgba: Buffer.from(raster.data.buffer, raster.data.byteOffset, raster.data.byteLength),
    png: encodePNG(raster.data, w, h),
  };
}

function renderLayer(raster, layer) {
  const blend = layer.blend || 'normal';
  const alphaMul = layer.alpha != null ? layer.alpha : 1;
  switch (layer.type) {
    case 'solid':    return renderSolid(raster, layer, blend, alphaMul);
    case 'gradient': return renderGradient(raster, layer, blend, alphaMul);
    case 'shape':    return renderShape(raster, layer, blend, alphaMul);
    case 'noise':    return renderNoise(raster, layer, blend, alphaMul);
    default: throw new Error(`Unknown layer type: ${layer.type}`);
  }
}

function renderSolid(raster, layer, blend, alphaMul) {
  const [r, g, b, a] = parseColor(layer.color);
  const alpha = (a * alphaMul) | 0;
  for (let y = 0; y < raster.height; y++)
    for (let x = 0; x < raster.width; x++)
      raster.blend(blend, x, y, r, g, b, alpha);
}

function renderGradient(raster, layer, blend, alphaMul) {
  const stops = (layer.stops || []).map((s) => ({ t: s.offset, rgba: parseColor(s.color) }));
  if (stops.length < 2) throw new Error('gradient needs at least 2 stops');
  stops.sort((a, b) => a.t - b.t);
  const kind = layer.kind || 'linear';
  const [fx, fy] = layer.from || [0, 0];
  const [tx, ty] = layer.to   || [raster.width, raster.height];

  let evalT;
  if (kind === 'linear') {
    const dx = tx - fx, dy = ty - fy;
    const lenSq = dx * dx + dy * dy || 1;
    evalT = (x, y) => Math.max(0, Math.min(1, ((x - fx) * dx + (y - fy) * dy) / lenSq));
  } else if (kind === 'radial') {
    const r = Math.hypot(tx - fx, ty - fy) || 1;
    evalT = (x, y) => Math.max(0, Math.min(1, Math.hypot(x - fx, y - fy) / r));
  } else throw new Error(`Unknown gradient kind: ${kind}`);

  for (let y = 0; y < raster.height; y++) {
    for (let x = 0; x < raster.width; x++) {
      const t = evalT(x + 0.5, y + 0.5);
      const c = sampleStops(stops, t);
      raster.blend(blend, x, y, c[0], c[1], c[2], (c[3] * alphaMul) | 0);
    }
  }
}

function sampleStops(stops, t) {
  if (t <= stops[0].t) return stops[0].rgba;
  if (t >= stops[stops.length - 1].t) return stops[stops.length - 1].rgba;
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i], b = stops[i + 1];
    if (t >= a.t && t <= b.t) {
      const k = (t - a.t) / Math.max(1e-9, b.t - a.t);
      return [
        a.rgba[0] + (b.rgba[0] - a.rgba[0]) * k | 0,
        a.rgba[1] + (b.rgba[1] - a.rgba[1]) * k | 0,
        a.rgba[2] + (b.rgba[2] - a.rgba[2]) * k | 0,
        a.rgba[3] + (b.rgba[3] - a.rgba[3]) * k | 0,
      ];
    }
  }
  return stops[stops.length - 1].rgba;
}

function renderShape(raster, layer, blend, alphaMul) {
  const sdf = makeShape(layer);
  const fillRGBA = layer.fill != null ? parseColor(layer.fill) : null;
  const strokeRGBA = layer.stroke?.color != null ? parseColor(layer.stroke.color) : null;
  const strokeW = (layer.stroke?.width || 0);
  const strokePos = layer.stroke?.position || 'centered';
  const aa = layer.antialias !== false;

  // Whole-canvas iteration for MVP. A bbox-clipped pass is a TODO once we add
  // sheet-builder hot loops where 90% of the canvas is empty.
  for (let y = 0; y < raster.height; y++) {
    for (let x = 0; x < raster.width; x++) {
      const d = sdf(x + 0.5, y + 0.5);

      // Fill coverage. The fill ends at d=0 (or pulled back to make room for an
      // outside stroke that should NOT overlap the fill, but for centered/inside
      // stroke we let it overlap and the stroke draws on top).
      if (fillRGBA) {
        let cov;
        if (aa) cov = 1 - smoothstep(-0.5, 0.5, d);
        else    cov = d <= 0 ? 1 : 0;
        if (cov > 0) {
          const a = (fillRGBA[3] * cov * alphaMul) | 0;
          if (a > 0) raster.blend(blend, x, y, fillRGBA[0], fillRGBA[1], fillRGBA[2], a);
        }
      }

      // Stroke as a band relative to d=0. Position controls which side the band lives on.
      if (strokeRGBA && strokeW > 0) {
        let bandSdf;
        if (strokePos === 'outside')      bandSdf = Math.max(-d, d - strokeW);            // band [0, +w]
        else if (strokePos === 'inside')  bandSdf = Math.max(d, -(d + strokeW));          // band [-w, 0]
        else                              bandSdf = Math.abs(d) - strokeW / 2;            // band [-w/2, +w/2]
        let cov;
        if (aa) cov = 1 - smoothstep(-0.5, 0.5, bandSdf);
        else    cov = bandSdf <= 0 ? 1 : 0;
        if (cov > 0) {
          const a = (strokeRGBA[3] * cov * alphaMul) | 0;
          if (a > 0) raster.blend(blend, x, y, strokeRGBA[0], strokeRGBA[1], strokeRGBA[2], a);
        }
      }
    }
  }
}

function renderNoise(raster, layer, blend, alphaMul) {
  const noise = makeNoise(layer);
  const [r, g, b, a] = parseColor(layer.color || '#FFFFFF');
  const lo = layer.lo != null ? layer.lo : 0;
  const hi = layer.hi != null ? layer.hi : 1;
  for (let y = 0; y < raster.height; y++) {
    for (let x = 0; x < raster.width; x++) {
      const n = noise(x + 0.5, y + 0.5);
      const t = Math.max(lo, Math.min(hi, n));
      const k = (t - lo) / Math.max(1e-9, hi - lo);
      const alpha = (a * k * alphaMul) | 0;
      if (alpha > 0) raster.blend(blend, x, y, r, g, b, alpha);
    }
  }
}

module.exports = { renderSpec };
