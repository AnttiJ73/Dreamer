'use strict';

const { commonArgs } = require('./_common');

module.exports = {
  kind: 'validate_sprite',
  summary: 'Run all sanity checks on a sliced sprite sheet — flags orphan pixel content, empty rects, partially-clipped boundaries, overlaps, duplicate names, out-of-bounds rects, low-density rects, and tiny rects. Read-only. Same `validation` field is auto-attached to every slice / extend / merge result; this command runs the checks on demand.',
  requirements: null,
  args: {
    ...commonArgs.target(['asset', 'guid']),
  },
  constraints: [commonArgs.targetAtLeastOne(['asset', 'guid'])],
  result: {
    type: 'object',
    fields: {
      ok: { type: 'boolean', description: 'False if any error- or warn-severity issue exists.' },
      summary: { type: 'string', description: 'One-line human summary of issues by kind.' },
      count: { type: 'integer' },
      warnings: {
        type: 'array',
        description: 'Each: { kind, severity, message, rect?, bounds?, detail? }. Severities: error (out_of_bounds, duplicate_name) | warn (empty_rect, partially_clipped, orphan_pixels) | info (overlap, low_density, tiny_rect).',
      },
    },
  },
  examples: [
    {
      title: 'Validate a sliced sheet on demand',
      cli: './bin/dreamer validate-sprite --asset Assets/Sprites/Decorations.png --wait',
      args: { assetPath: 'Assets/Sprites/Decorations.png' },
    },
  ],
  pitfalls: [
    'Validation runs automatically inside slice-sprite, extend-sprite, and merge results under the `validation` field — you usually don\'t need to call this command separately. Use it for spot-checks against assets you didn\'t modify yourself.',
    'Severity tiers: `error` (must fix — invalid state), `warn` (likely a bug worth investigating), `info` (anomaly that may be intentional like merge-bbox overlap). LLMs scanning the result can filter by severity.',
    'Orphan-pixel detection requires `isReadable=true` on the texture. Without it, the geometry checks (out_of_bounds, duplicate_name, tiny_rect, overlap) still run but content checks are skipped — surfaced as a `pixel_read_failed` info entry.',
    '`partially_clipped` means an inside-edge pixel AND its outside neighbour are BOTH opaque. Anti-aliased edges crossing a 0.5 alpha threshold flag occasionally — verify visually via preview-sprite before re-slicing.',
    'Orphan-pixel min size is 64 opaque pixels (8x8 block). Smaller specks count as anti-aliasing dust and are ignored — adjust source-side if dust is intentional content.',
  ],
  seeAlso: [
    './bin/dreamer help slice_sprite     — slice ops auto-attach the same validation report',
    './bin/dreamer help extend_sprite    — extend ops auto-attach the same validation report',
    './bin/dreamer help preview_sprite   — visual confirmation of validator findings',
  ],
};
