'use strict';

const { commonArgs } = require('./_common');

module.exports = {
  kind: 'extend_sprite',
  summary: 'Re-slice a sprite sheet WITHOUT losing existing rect names or spriteIDs — preserves prefab / animation / Animator references. Two-stage matching: (1) IoU against auto-detected islands handles "added new sprites in whitespace", (2) template-matching against cached snapshots (auto-built by every slice op) handles "existing sprites moved to new positions" after a canvas resize. Unmatched detected islands become new rects with the next available index. Unmatched existing rects are reported as orphans (kept in place; agent decides).',
  requirements: null,
  args: {
    ...commonArgs.target(['asset', 'guid']),
    namePrefix: {
      type: 'string',
      cli: '--name-prefix',
      description: 'Prefix for newly-added rects (default = texture filename). New rects get names `<prefix>_<N>` where N continues from the highest existing index.',
    },
    minSize: {
      type: 'integer',
      cli: '--min-size',
      description: 'Auto-detect minimum island width/height (default 16).',
    },
    iouThreshold: {
      type: 'number',
      cli: '--iou-threshold',
      description: 'Stage 1 — IoU threshold for considering an existing rect to match an auto-detected island (default 0.5).',
    },
    matchThreshold: {
      type: 'number',
      cli: '--match-threshold',
      description: 'Stage 2 — pixel-match threshold (0..1) for template matching against cached snapshots (default 0.85). Lower = more permissive but more false-positive realigns.',
    },
    alignment: {
      type: 'string',
      cli: '--alignment',
      enum: ['Center', 'TopLeft', 'TopCenter', 'TopRight', 'LeftCenter', 'RightCenter', 'BottomLeft', 'BottomCenter', 'BottomRight', 'Custom'],
      description: 'Default pivot alignment for newly-added rects (default Center). Existing rects keep their original alignment.',
    },
    pivot: {
      type: ['object', 'array'],
      cli: '--pivot',
      description: 'Custom pivot when alignment=Custom — [x,y] or {x,y} in 0..1 sprite-rect space.',
    },
  },
  constraints: [commonArgs.targetAtLeastOne(['asset', 'guid'])],
  result: {
    type: 'object',
    fields: {
      extended: { type: 'boolean' },
      kept: { type: 'integer', description: 'Existing rects matched via IoU (Stage 1). Position snapped to the candidate island\'s exact bounds.' },
      realigned: { type: 'integer', description: 'Existing rects template-matched against cached snapshots (Stage 2). Repositioned to the new location.' },
      added: { type: 'integer', description: 'New rects appended for auto-detected islands not matched to any existing rect.' },
      orphaned: { type: 'integer', description: 'Existing rects with no IoU AND no template match. Kept in place — agent should preview and decide.' },
      cacheAvailable: { type: 'boolean', description: 'False if no snapshot cache existed for this asset (template matching skipped — orphans may include moved sprites).' },
      realignedDetails: { type: 'array' },
      addedRects: { type: 'array' },
      orphanedRects: { type: 'array' },
    },
  },
  examples: [
    {
      title: 'Add new sprites to an existing sheet, preserve all references',
      cli: './bin/dreamer extend-sprite --asset Assets/Sprites/Decorations.png --wait',
      args: { assetPath: 'Assets/Sprites/Decorations.png' },
    },
    {
      title: 'Stricter IoU + permissive template-match (sheet was reorganized)',
      cli: './bin/dreamer extend-sprite --asset Assets/Sprites/Decorations.png --iou-threshold 0.7 --match-threshold 0.75 --wait',
      args: { assetPath: 'Assets/Sprites/Decorations.png', iouThreshold: 0.7, matchThreshold: 0.75 },
    },
  ],
  pitfalls: [
    'Template-match cache is auto-populated by EVERY successful slice/extend operation. If the asset was sliced before this command shipped, run extend-sprite once on the unchanged sheet to bootstrap the cache, THEN edit, THEN run extend-sprite again — otherwise the FIRST extend after edits has only IoU-matching available.',
    'Cache lives in `Library/Dreamer/SpriteSlices/<guid>/` — gitignored, lost when the user clears Library/. After a Library wipe, the next slice/extend op rebuilds it.',
    'Four-pass match: (A) IoU vs auto-islands, (B) template vs candidates of similar size ±10%, (C) coherent-motion guess at oldPos + median-delta, (D) brute-force scan with sample-pixel early-exit. Sprites that DON\'T match any of those become orphans — typical reason: artist redrew the pixels (template no longer matches anywhere).',
    'Brute-force tie-breaks by proximity to the median-motion hint, so repetitive content (tilesets where dozens of cells look identical) tends to keep each rect closer to its old position rather than colliding on the first lexical match.',
    'Existing rect names follow `<prefix>_<index>` for new-rect generation. If existing names use a different scheme, new rects still get `<prefix>_<N>` numbering — set `--name-prefix` to control.',
    'Texture must be readable. Run `set-import-property --asset PATH --property isReadable --value true --wait` first.',
  ],
  seeAlso: [
    './bin/dreamer help slice_sprite       — destructive grid/auto/rects/merge slicing',
    './bin/dreamer help preview_sprite     — verify visually after extend',
    './bin/dreamer help set_import_property — set isReadable before extend',
  ],
};
