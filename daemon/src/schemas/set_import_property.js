'use strict';

const { commonArgs } = require('./_common');

module.exports = {
  kind: 'set_import_property',
  summary: 'Set a property on the AssetImporter for a given asset (TextureImporter / ModelImporter / AudioImporter / etc.). Reflects on the importer subclass — accepts any public writable property. Use this for import-time settings the runtime asset never exposes (PPU, filterMode, textureType, mipmapEnabled, isReadable, …). Auto-reimports.',
  requirements: null,
  args: {
    ...commonArgs.target(['asset', 'guid']),
    propertyName: {
      type: 'string',
      required: true,
      cli: '--property',
      description: 'Importer property name (case-sensitive C# property). Common TextureImporter: spritePixelsPerUnit, filterMode, textureType, spriteImportMode, mipmapEnabled, isReadable, maxTextureSize, wrapMode, alphaIsTransparency.',
    },
    value: {
      type: 'any',
      required: true,
      cli: '--value',
      description: 'JSON value. Enums by name (case-insensitive): `"Point"` for FilterMode, `"Sprite"` for TextureImporterType. Numbers/booleans pass through. Vectors: [x,y] or {x,y}.',
    },
  },
  constraints: [commonArgs.targetAtLeastOne(['asset', 'guid'])],
  result: {
    type: 'object',
    fields: {
      set: { type: 'boolean' },
      assetPath: { type: 'string' },
      importer: { type: 'string', description: 'Importer subclass (e.g. "TextureImporter").' },
      property: { type: 'string' },
      propertyType: { type: 'string' },
      oldValue: { type: 'string' },
      newValue: { type: 'string' },
    },
  },
  examples: [
    {
      title: 'Set Pixels Per Unit on a texture',
      cli: './bin/dreamer set-import-property --asset Assets/Sprites/Hero.png --property spritePixelsPerUnit --value 200 --wait',
      args: { assetPath: 'Assets/Sprites/Hero.png', propertyName: 'spritePixelsPerUnit', value: 200 },
    },
    {
      title: 'Switch filter mode to Point (pixel-art crispness)',
      cli: `./bin/dreamer set-import-property --asset Assets/Sprites/Hero.png --property filterMode --value '"Point"' --wait`,
      args: { assetPath: 'Assets/Sprites/Hero.png', propertyName: 'filterMode', value: 'Point' },
    },
    {
      title: 'Mark a texture readable so slice-sprite --mode auto can scan it',
      cli: './bin/dreamer set-import-property --asset Assets/Sheet.png --property isReadable --value true --wait',
      args: { assetPath: 'Assets/Sheet.png', propertyName: 'isReadable', value: true },
    },
    {
      title: 'Switch a Default texture to Sprite type',
      cli: `./bin/dreamer set-import-property --asset Assets/UI/Button.png --property textureType --value '"Sprite"' --wait`,
      args: { assetPath: 'Assets/UI/Button.png', propertyName: 'textureType', value: 'Sprite' },
    },
  ],
  pitfalls: [
    'Property names are CASE-SENSITIVE C# property names (e.g. `filterMode`, NOT `m_FilterMode`). On miss, the error lists every writable property on the importer.',
    'Enum values pass as STRINGS quoted in JSON (`--value \'"Point"\'`), NOT as plain `Point`. JSON quoting matters.',
    'For `spriteImportMode` use the enum names (`Single`, `Multiple`, `Polygon`), not numeric codes.',
    'Sprite-specific authoring (the spritesheet rects, pivots, names) does NOT go through this — use `slice-sprite` for that. This command is for scalar/enum/struct fields only.',
    'After this call, the asset is reimported. If the new value forces re-derivation of dependent metadata, downstream queries should re-inspect.',
  ],
  seeAlso: [
    './bin/dreamer help slice_sprite     — author the spritesheet rects (Multiple-mode authoring)',
    './bin/dreamer help preview_sprite   — visual verification',
  ],
};
