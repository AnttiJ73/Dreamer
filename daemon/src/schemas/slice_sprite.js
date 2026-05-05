'use strict';

const { commonArgs } = require('./_common');

module.exports = {
  kind: 'slice_sprite',
  summary: 'Slice a sprite-sheet texture into named sub-sprites. Four modes: `grid` (cell W×H), `auto` (connected-component scan), `rects` (explicit JSON), `merge` (combine existing rects into a union-bbox rect — for composite islands like a character with shadow + weapon parts). Sets spriteImportMode=Multiple and reimports. Existing names with matching new entries keep their spriteID — preserves prefab/animation references. Pair with `preview-sprite` to verify.',
  requirements: null,
  args: {
    ...commonArgs.target(['asset', 'guid']),
    mode: {
      type: 'string',
      required: true,
      cli: '--mode',
      enum: ['grid', 'auto', 'rects', 'merge'],
      description: 'grid | auto | rects | merge.',
    },
    cell: {
      type: ['object', 'array', 'string'],
      cli: '--cell',
      description: 'Grid mode only — cell size as "32x32" string, [w,h] array, or {x,y} object.',
    },
    padding: {
      type: ['object', 'array', 'string'],
      cli: '--padding',
      description: 'Grid mode — pixel gap between cells, same shapes as `cell`. Default 0.',
    },
    offset: {
      type: ['object', 'array', 'string'],
      cli: '--offset',
      description: 'Grid mode — pixel offset from texture top-left, same shapes as `cell`. Default 0.',
    },
    minSize: {
      type: 'integer',
      cli: '--min-size',
      description: 'Auto mode — minimum island width/height to keep (default 16).',
    },
    extrude: {
      type: 'integer',
      cli: '--extrude',
      description: 'Auto mode — pixels to extrude rects outward (default 0).',
    },
    rects: {
      type: 'array',
      cli: '--rects',
      description: 'Explicit-rects mode — array of {name, x, y, w, h, alignment?, pivot?}. Pivot accepts [x,y] (0..1).',
    },
    groups: {
      type: 'array',
      cli: '--groups',
      description: 'Merge mode — array of {keep:"NewName", absorb:["existing1","existing2",...]}. Computes the union bounding box of `absorb` rects, removes them, adds a single rect named `keep`.',
    },
    namePrefix: {
      type: 'string',
      cli: '--name-prefix',
      description: 'Generated rect name prefix (default = texture filename). Result names are `<prefix>_<index>`.',
    },
    alignment: {
      type: 'string',
      cli: '--alignment',
      enum: ['Center', 'TopLeft', 'TopCenter', 'TopRight', 'LeftCenter', 'RightCenter', 'BottomLeft', 'BottomCenter', 'BottomRight', 'Custom'],
      description: 'Default pivot alignment for generated rects (default Center). Per-rect override available in `rects` mode.',
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
      sliced: { type: 'boolean' },
      mode: { type: 'string' },
      rectsCreated: { type: 'integer' },
      flippedToMultipleMode: { type: 'boolean', description: 'True if the asset was Single before this call.' },
      // merge mode:
      merged: { type: 'boolean' },
      groupsApplied: { type: 'integer' },
      totalRectsAfter: { type: 'integer' },
      summary: { type: 'array', description: 'Merge mode — per-group [{keep, absorbed, rect}].' },
    },
  },
  examples: [
    {
      title: 'Grid slice — 32x32 tiles',
      cli: './bin/dreamer slice-sprite --asset Assets/Tiles/Tileset.png --mode grid --cell 32x32 --name-prefix Tile --wait',
      args: { assetPath: 'Assets/Tiles/Tileset.png', mode: 'grid', cell: '32x32', namePrefix: 'Tile' },
    },
    {
      title: 'Auto slice — detect each connected island',
      cli: './bin/dreamer slice-sprite --asset Assets/_DreamerTest/Stage1_Decorations.png --mode auto --min-size 32 --wait',
      args: { assetPath: 'Assets/_DreamerTest/Stage1_Decorations.png', mode: 'auto', minSize: 32 },
    },
    {
      title: 'Explicit rects',
      cli: `./bin/dreamer slice-sprite --asset Assets/Sheet.png --mode rects --rects '[{"name":"Idle_0","x":0,"y":0,"w":32,"h":32},{"name":"Idle_1","x":32,"y":0,"w":32,"h":32}]' --wait`,
      args: { assetPath: 'Assets/Sheet.png', mode: 'rects', rects: [
        { name: 'Idle_0', x: 0, y: 0, w: 32, h: 32 },
        { name: 'Idle_1', x: 32, y: 0, w: 32, h: 32 },
      ] },
    },
    {
      title: 'Merge composite islands — combine three auto-sliced rects into one named sprite',
      cli: `./bin/dreamer slice-sprite --asset Assets/Sheet.png --mode merge --groups '[{"keep":"Player_Idle","absorb":["auto_3","auto_4","auto_5"]}]' --wait`,
      args: { assetPath: 'Assets/Sheet.png', mode: 'merge', groups: [
        { keep: 'Player_Idle', absorb: ['auto_3', 'auto_4', 'auto_5'] },
      ] },
    },
  ],
  pitfalls: [
    'Auto mode REQUIRES isReadable=true on the texture. Set it first: `set-import-property --asset PATH --property isReadable --value true --wait`. Otherwise auto-slice errors with that hint.',
    'Slicing OVERWRITES the existing spritesheet for grid/auto/rects modes. To non-destructively combine existing rects, use `mode: merge`.',
    'Merge mode keeps the FIRST absorbed rect\'s alignment + pivot. Override afterward via `slice-sprite --mode rects` if you need different anchors.',
    'For composite-island merging (e.g. character with separate shadow blob), use `preview-sprite --asset PATH` first to see auto-slice output with named outlines, then identify which auto_N names should merge.',
    'Y axis is texture pixel-space — bottom-left origin in Unity. Grid mode iterates from top-row to bottom to match Unity\'s "Slice Grid By Cell Size" naming.',
    'After slicing, run `preview-sprite --asset PATH` to verify visually before relying on the new sprite names.',
  ],
  seeAlso: [
    './bin/dreamer help preview_sprite      — visual verification of slicing',
    './bin/dreamer help set_import_property — set isReadable, spritePixelsPerUnit, filterMode',
  ],
};
