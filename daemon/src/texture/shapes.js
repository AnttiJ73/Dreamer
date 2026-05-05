'use strict';

// SDF primitives. Each `make*` returns a function `sdf(x, y) => signed distance`
// where the distance is in pixels, < 0 inside the shape, > 0 outside, == 0 on
// the boundary. Use SDFs for AA (smoothstep over 1 px around the boundary) and
// for stroke ("inside the band [-w/2, +w/2] around 0"). All shapes accept a
// rotation in radians where applicable.

function makeCircle({ center, radius }) {
  const [cx, cy] = center;
  const r = radius;
  return (x, y) => Math.hypot(x - cx, y - cy) - r;
}

function makeRect({ center, size, rotation = 0, cornerRadius = 0 }) {
  const [cx, cy] = center;
  const [w, h] = size;
  const hw = w / 2 - cornerRadius;
  const hh = h / 2 - cornerRadius;
  const cs = Math.cos(-rotation);
  const sn = Math.sin(-rotation);
  return (x, y) => {
    // Rotate point into rect's local frame, then SDF for axis-aligned rounded rect.
    const dx = x - cx, dy = y - cy;
    const lx = dx * cs - dy * sn;
    const ly = dx * sn + dy * cs;
    const ax = Math.abs(lx) - hw;
    const ay = Math.abs(ly) - hh;
    const outside = Math.hypot(Math.max(ax, 0), Math.max(ay, 0));
    const inside = Math.min(Math.max(ax, ay), 0);
    return outside + inside - cornerRadius;
  };
}

function makePolygon({ center, radius, sides, rotation = 0 }) {
  // Regular n-gon. The closed-form SDF (iquilezles) had sector-boundary
  // artifacts when I tried to roll my own; for now we just emit the vertex
  // list and reuse makeGeneralPolygon. Slower per-pixel (O(n) instead of O(1))
  // but always correct, and n is small for normal use (3..12).
  const [cx, cy] = center;
  const n = Math.max(3, sides | 0);
  const verts = [];
  // First vertex points UP (-Y in screen space) so a hexagon reads as expected.
  for (let i = 0; i < n; i++) {
    const ang = -Math.PI / 2 + rotation + (i * 2 * Math.PI) / n;
    verts.push([cx + radius * Math.cos(ang), cy + radius * Math.sin(ang)]);
  }
  return makeGeneralPolygon(verts);
}

function makeStar({ center, outerRadius, innerRadius, points, rotation = 0 }) {
  // Star = polygon with alternating radii. Build the point list, use polygon SDF.
  const [cx, cy] = center;
  const n = Math.max(3, points | 0);
  const verts = [];
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 === 0 ? outerRadius : innerRadius;
    const ang = -Math.PI / 2 + rotation + (i * Math.PI) / n;
    verts.push([cx + r * Math.cos(ang), cy + r * Math.sin(ang)]);
  }
  return makeGeneralPolygon(verts);
}

function makePlus({ center, size, thickness, rotation = 0 }) {
  // Plus = union of horizontal + vertical bars. Take min of two rect SDFs.
  const horiz = makeRect({ center, size: [size, thickness], rotation });
  const vert  = makeRect({ center, size: [thickness, size], rotation });
  return (x, y) => Math.min(horiz(x, y), vert(x, y));
}

function makeLine({ from, to, thickness }) {
  const [ax, ay] = from;
  const [bx, by] = to;
  const half = thickness / 2;
  return (x, y) => {
    const pax = x - ax, pay = y - ay;
    const bax = bx - ax, bay = by - ay;
    const lenSq = bax * bax + bay * bay;
    let t = lenSq === 0 ? 0 : (pax * bax + pay * bay) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const dx = pax - t * bax, dy = pay - t * bay;
    return Math.hypot(dx, dy) - half;
  };
}

// SDF for a general (convex or simple) polygon defined by vertex list.
// Reference: iquilezles "polygon SDF". Works for any closed polygon — sign
// determined by winding-number test (even/odd ray cast).
function makeGeneralPolygon(verts) {
  const n = verts.length;
  return (x, y) => {
    let d = Infinity;
    let inside = false;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const [vix, viy] = verts[i];
      const [vjx, vjy] = verts[j];
      // Distance from point to edge segment vi-vj.
      const ex = vjx - vix, ey = vjy - viy;
      const wx = x - vix, wy = y - viy;
      const lenSq = ex * ex + ey * ey;
      let t = lenSq === 0 ? 0 : (wx * ex + wy * ey) / lenSq;
      t = Math.max(0, Math.min(1, t));
      const dx = wx - t * ex, dy = wy - t * ey;
      const dist = Math.hypot(dx, dy);
      if (dist < d) d = dist;
      // Even-odd ray cast for inside test.
      if ((viy > y) !== (vjy > y) && x < vix + (vjx - vix) * (y - viy) / (vjy - viy)) {
        inside = !inside;
      }
    }
    return inside ? -d : d;
  };
}

function makeShape(spec) {
  switch (spec.shape) {
    case 'circle':  return makeCircle(spec);
    case 'rect':    return makeRect(spec);
    case 'polygon': return makePolygon(spec);
    case 'star':    return makeStar(spec);
    case 'plus':    return makePlus(spec);
    case 'line':    return makeLine(spec);
    default:        throw new Error(`Unknown shape: ${spec.shape}`);
  }
}

module.exports = { makeShape, makeCircle, makeRect, makePolygon, makeStar, makePlus, makeLine, makeGeneralPolygon };
