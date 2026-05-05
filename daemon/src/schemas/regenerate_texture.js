'use strict';

module.exports = {
  kind: 'regenerate_texture',
  summary: 'Re-render a texture from a saved spec file. The CLI verb of the iteration loop: edit the spec JSON, run `regenerate-texture --spec foo.json`, the PNG is rewritten to the spec\'s `out` path AND `refresh-assets` is auto-run so Unity reimports immediately. No need to re-pass --out or --refresh on every iteration.',
  requirements: null,
  args: {
    spec: {
      type: 'string',
      required: true,
      cli: '--spec',
      description: 'Path to the spec file. The spec must contain an `out` field (the PNG output path) — `regenerate-texture` is the lazy form of `generate-texture --spec FILE --out PATH --refresh`. If you want to override the output path, pass `--out` explicitly.',
    },
    out: {
      type: 'string',
      cli: '--out',
      description: 'Override the spec\'s `out` field for this run. Useful for "what if I rendered it bigger?" experiments without editing the spec.',
    },
  },
  result: {
    type: 'object',
    fields: {
      regenerated: { type: 'boolean' },
      specPath: { type: 'string' },
      path: { type: 'string' },
      width: { type: 'integer' },
      height: { type: 'integer' },
      byteCount: { type: 'integer' },
      layers: { type: 'integer' },
      renderMs: { type: 'integer' },
    },
  },
  examples: [
    {
      title: 'Iteration loop step',
      cli: './bin/dreamer regenerate-texture --spec Assets/_DreamerTextures/specs/orb.json',
      args: { spec: 'Assets/_DreamerTextures/specs/orb.json' },
    },
    {
      title: '4× upscale preview without touching the spec',
      cli: './bin/dreamer regenerate-texture --spec Assets/_DreamerTextures/specs/orb.json --out /tmp/orb-4x.png',
      args: {},
    },
  ],
  pitfalls: [
    'The spec file must include an `out` field (e.g. `"out": "Assets/Textures/orb.png"`). Without it, the CLI errors and tells you to either add it or pass --out.',
    'Auto-runs `refresh-assets` (so Unity reimports). If you don\'t want that — for an out-of-Assets path, say — use `generate-texture` instead and skip the --refresh flag.',
    'Spec format is identical to `generate-texture`. Sheet specs are NOT supported here — use `generate-sheet --spec FILE` for sheet regeneration.',
  ],
  seeAlso: [
    './bin/dreamer help generate_texture  — first-time generation, accepts inline specs.',
    './bin/dreamer help generate_sheet    — sprite-sheet renderer; sheet specs use a different schema.',
  ],
};
