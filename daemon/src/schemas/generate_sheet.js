'use strict';

module.exports = {
  kind: 'generate_sheet',
  summary: 'Render a sprite-sheet (grid of tiles) as one PNG. Two modes: explicit `tiles` (a list of full per-tile specs) or animation (`base` spec + `interpolate` ranges that drive each tile by frame index). Each tile is rendered at the configured `tileSize` and pasted into a `cols × rows` grid with optional gutter. Pure Node — same fast iteration loop as `generate-texture`. Pair with `slice-sprite` to import as a Sprite atlas.',
  requirements: null,
  args: {
    spec: {
      type: 'string',
      cli: '--spec',
      description: 'Path to a JSON sheet spec file. Sheet spec shape: `{ tileSize: [W, H], cols, rows, gap?, background?, tiles?: [...] | base?: tileSpec, frames?, interpolate?: { "layers[0].radius": [start, end] } }`.',
    },
    inlineSpec: {
      type: 'string',
      cli: '--inline-spec',
      description: 'JSON string with the sheet spec inline (instead of `--spec`).',
    },
    out: {
      type: 'string',
      required: true,
      cli: '--out',
      description: 'Output PNG path.',
    },
    refresh: {
      type: 'boolean',
      cli: '--refresh',
      description: 'Run `refresh-assets` after writing so Unity reimports immediately.',
    },
  },
  result: {
    type: 'object',
    fields: {
      generated: { type: 'boolean' },
      path: { type: 'string' },
      width: { type: 'integer' },
      height: { type: 'integer' },
      cols: { type: 'integer' },
      rows: { type: 'integer' },
      tileWidth: { type: 'integer' },
      tileHeight: { type: 'integer' },
      tileCount: { type: 'integer' },
      tiles: {
        type: 'array',
        description: 'Per-tile metadata: `{ index, col, row, x, y, w, h }`. Useful for `slice-sprite --grid` after import.',
      },
      byteCount: { type: 'integer' },
      renderMs: { type: 'integer' },
    },
  },
  examples: [
    {
      title: 'Animated growing-circle (4 frames in a 4×1 row)',
      cli: './bin/dreamer generate-sheet --spec Assets/_DreamerTextures/specs/expand.json --out Assets/Textures/expand.png',
      args: { spec: 'Assets/_DreamerTextures/specs/expand.json', out: 'Assets/Textures/expand.png' },
    },
    {
      title: 'Animated puff via inline interpolation (radius 5→25, color yellow→red, 4 frames in 2×2)',
      cli: `./bin/dreamer generate-sheet --inline-spec '{"tileSize":[64,64],"cols":2,"rows":2,"frames":4,"background":"#00000000","base":{"layers":[{"type":"shape","shape":"circle","center":[32,32],"radius":5,"fill":"#FFEE00","stroke":{"color":"#222","width":2}}]},"interpolate":{"layers[0].radius":[5,25],"layers[0].fill":["#FFEE00","#FF2200"]}}' --out Assets/Textures/puff.png`,
      args: {},
    },
    {
      title: 'Explicit tile mode (different shape per tile)',
      cli: './bin/dreamer generate-sheet --spec Assets/_DreamerTextures/specs/icons.json --out Assets/Textures/icons.png',
      args: {},
    },
  ],
  pitfalls: [
    'Sheet width = cols × tileWidth + (cols + 1) × gap. Same for height. Plan your tileSize and grid so the total fits Unity\'s max texture size (8192² is the hard cap here, but 2048² is the common sprite-atlas budget).',
    'Animation mode interpolates LINEARLY between range[0] and range[1] across frames. For non-linear motion, use explicit-tile mode and write each frame yourself.',
    'Property paths use `lodash`-style: `layers[0].radius`, `layers[2].center[0]`, `background`. Typos throw at render time so you find out fast.',
    'Color interpolation is channel-wise on hex strings (e.g. "#FFEE00" → "#FF2200" interpolates each channel independently). For perceptual interpolation, do it in HSL via your own preprocessing — not built in.',
    'After import, use `slice-sprite --grid <cols> <rows>` to slice the sheet into individual sprites. The result.tiles array gives exact pixel positions if you need them.',
    'Each tile is rendered fresh per call — no cross-tile dependencies. If you need carryover (e.g. trails accumulating across frames), do it via your interpolation curve (e.g. add a fading-trail layer with `alpha` interpolated 0→0.3).',
  ],
  seeAlso: [
    './bin/dreamer help generate_texture     — single-texture renderer; sheet builder uses the same layer system.',
    './bin/dreamer help slice_sprite         — slice the resulting sheet into individual sprite assets.',
    './bin/dreamer help regenerate_texture   — re-run a saved spec after editing it (same iteration loop, applies to sheets too).',
  ],
};
