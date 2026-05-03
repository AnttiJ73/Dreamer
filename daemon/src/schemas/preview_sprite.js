'use strict';

const { commonArgs } = require('./_common');

module.exports = {
  kind: 'preview_sprite',
  summary: 'Render a sprite (or one sub-sprite from a sliced sheet) to PNG. Default for Multiple-mode sheets: full texture with colored rect outlines per sub-sprite + a `sprites[]` array mapping color→name. Use `--sub-sprite NAME` to extract a single rect. Open the resulting PNG with the Read tool to view it.',
  requirements: null,
  args: {
    ...commonArgs.target(['asset', 'guid']),
    subSprite: {
      type: 'string',
      cli: '--sub-sprite',
      description: 'Name of a sliced sub-sprite to extract individually (skip for the full-sheet highlight view). Use `inspect-asset` or run preview-sprite without it first to discover the names.',
    },
    outlineThickness: {
      type: 'integer',
      cli: '--outline-thickness',
      description: 'Highlight-mode outline thickness in pixels (1–8, default 2).',
    },
    savePath: {
      type: 'string',
      cli: '--save-to',
      description: 'PNG output path. Defaults to DreamerScreenshots/sprite-<assetname>-<ticks>.png.',
    },
  },
  constraints: [commonArgs.targetAtLeastOne(['asset', 'guid'])],
  result: {
    type: 'object',
    fields: {
      path: { type: 'string', description: 'PNG file path — open with the Read tool.' },
      mode: { type: 'string', description: '"sub-sprite" | "highlight" | "single".' },
      subSpriteCount: { type: 'integer' },
      sprites: { type: 'array', description: 'Highlight mode only: [{name, rect:{x,y,width,height}, color:"#RRGGBB"}].' },
      width: { type: 'integer' },
      height: { type: 'integer' },
    },
  },
  examples: [
    {
      title: 'Preview a sliced sheet (full texture with outlines)',
      cli: './bin/dreamer preview-sprite --asset Assets/_DreamerTest/Stage1_Decorations.png --wait',
      args: { assetPath: 'Assets/_DreamerTest/Stage1_Decorations.png' },
    },
    {
      title: 'Preview a single sub-sprite from the sheet',
      cli: './bin/dreamer preview-sprite --asset Assets/_DreamerTest/Stage1_Decorations.png --sub-sprite Stage1_Decorations_3 --wait',
      args: { assetPath: 'Assets/_DreamerTest/Stage1_Decorations.png', subSprite: 'Stage1_Decorations_3' },
    },
  ],
  pitfalls: [
    'Highlight mode draws outlines INTO a copy of the texture (not the asset). The PNG is read-only output; the source texture is untouched.',
    'Non-readable textures still work — preview round-trips through a RenderTexture so it does NOT mutate `isReadable`. Slicing (auto mode) DOES need readable; that\'s a separate command.',
    'For single-sprite (Single mode) textures, `subSprite` will fail with "no sub-sprites — texture is Single mode". Slice it first via `slice-sprite --mode grid|auto|rects`.',
    'PNG is written to DreamerScreenshots/ at the project root. Use `--save-to PATH` to redirect.',
  ],
  seeAlso: [
    './bin/dreamer help slice_sprite      — produce / merge / replace sub-sprite rects',
    './bin/dreamer help set_import_property — set TextureImporter fields like spritePixelsPerUnit, filterMode',
  ],
};
