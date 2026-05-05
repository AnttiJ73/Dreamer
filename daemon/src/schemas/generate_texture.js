'use strict';

module.exports = {
  kind: 'generate_texture',
  summary: 'Render a procedural texture (PNG) from a layered JSON spec. Pure Node — runs in the CLI process, no Unity round-trip needed. Layers compose in order: solid fills, linear/radial gradients, SDF shapes (circle, rect, polygon, star, plus, line) with anti-aliased fills + outlines, and procedural noise (white, value, perlin, voronoi). Output lands at the path you specify (typically under `Assets/...` so Unity picks it up via the next refresh). Pair with `refresh-assets` + `set-import-property` to import as a Sprite.',
  requirements: null,
  args: {
    spec: {
      type: 'string',
      cli: '--spec',
      description: 'Path to a JSON file with the full spec `{ size: [W, H], background?: color, layers: [...] }`. Use this for anything beyond a one-shape texture — store specs under `Assets/_DreamerTextures/specs/` so re-running is a one-line edit + regenerate.',
    },
    inlineSpec: {
      type: 'string',
      cli: '--inline-spec',
      description: 'JSON string with the spec inline (instead of `--spec`). Useful for tiny one-off textures without saving a file. Quote the JSON properly for your shell — heredocs are easier in bash.',
    },
    out: {
      type: 'string',
      required: true,
      cli: '--out',
      description: 'Output PNG path. Typically `Assets/Textures/foo.png` so Unity picks it up. Parent directory is created if missing.',
    },
    refresh: {
      type: 'boolean',
      cli: '--refresh',
      description: 'Run `refresh-assets` after writing so Unity reimports immediately. Default false (the agent usually batches several texture writes and refreshes once).',
    },
  },
  result: {
    type: 'object',
    fields: {
      generated: { type: 'boolean' },
      path: { type: 'string', description: 'Output PNG path. Read this with the Read tool to verify the result.' },
      width: { type: 'integer' },
      height: { type: 'integer' },
      byteCount: { type: 'integer' },
      layers: { type: 'integer', description: 'Number of layers rendered (background not counted).' },
      renderMs: { type: 'integer', description: 'Total render+encode time in ms (typically <50 for 256×256).' },
    },
  },
  examples: [
    {
      title: 'Single orange circle with black outline (one-shape inline spec)',
      cli: `./bin/dreamer generate-texture --inline-spec '{"size":[128,128],"background":"#00000000","layers":[{"type":"shape","shape":"circle","center":[64,64],"radius":50,"fill":"#FF8800","stroke":{"color":"#000000","width":4}}]}' --out Assets/Textures/orb.png`,
      args: {
        inlineSpec: '{"size":[128,128],"background":"#00000000","layers":[{"type":"shape","shape":"circle","center":[64,64],"radius":50,"fill":"#FF8800","stroke":{"color":"#000000","width":4}}]}',
        out: 'Assets/Textures/orb.png',
      },
    },
    {
      title: 'Composite: gradient + noise + foreground shape',
      cli: './bin/dreamer generate-texture --spec Assets/_DreamerTextures/specs/sunset.json --out Assets/Textures/sunset.png --refresh',
      args: { spec: 'Assets/_DreamerTextures/specs/sunset.json', out: 'Assets/Textures/sunset.png', refresh: true },
    },
    {
      title: 'Voronoi cell pattern',
      cli: `./bin/dreamer generate-texture --inline-spec '{"size":[128,128],"layers":[{"type":"noise","kind":"voronoi","scale":0.18,"seed":42,"color":"#88AAEE"}]}' --out Assets/Textures/cells.png`,
      args: {},
    },
  ],
  pitfalls: [
    'Specs are layer LISTS, not trees — each layer composites onto the running buffer. To get a "circle inside a square", that\'s two shape layers (square first, then circle). Order matters.',
    'Coordinates are top-left origin (Y grows DOWN). PNG / Unity sprite import flips this for you, but spec authors should think top-down.',
    'AA is on by default (`antialias: true` per shape). Turn it off for pixel-art where you want hard edges.',
    'Stroke `position` is `centered` by default (half inside, half outside the shape boundary). Use `outside` for emphasis (the stroke sits entirely outside the fill) or `inside` for inset edges.',
    'Color shorthands: `#RGB`, `#RGBA`, `#RRGGBB`, `#RRGGBBAA`. Or `{r,g,b,a}` with 0..1 floats. Or `[r,g,b,a]` with 0..255 ints.',
    'Output is RGBA8 PNG. Pass `set-import-property` afterward to set Sprite import settings if you want a Sprite (texture-type 8, alpha-is-transparency, etc.) — generate-texture only writes the PNG.',
    'Pure Node — runs without Unity. Means you can iterate on textures while Unity is unfocused or compiling.',
  ],
  seeAlso: [
    './bin/dreamer help refresh_assets       — call after generate-texture to import the PNG into Unity.',
    './bin/dreamer help set_import_property  — configure the resulting texture (sprite mode, ppu, filtering, etc.).',
    './bin/dreamer help create_material      — make a material that uses the generated texture.',
  ],
};
