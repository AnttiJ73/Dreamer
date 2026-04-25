'use strict';

module.exports = {
  kind: 'set_material_property',
  summary: 'Set a Material property (Color, Vector, Float, Range, Texture) OR toggle a shader keyword. CLI verb: `set-material-property`. Materials use Unity\'s MaterialProperty API rather than serialized fields, which is why `set-property` doesn\'t reach them. Run inspect-material first to see real property names — they\'re shader-defined (e.g. _BaseColor, _Smoothness, _BaseMap), NOT camelCase.',
  requirements: null,
  args: {
    assetPath: {
      type: 'string',
      cli: '--asset',
      description: 'Path to the .mat asset.',
    },
    guid: {
      type: 'string',
      cli: '--asset (GUID form)',
      description: 'Material GUID — alternative to assetPath.',
    },
    property: {
      type: 'string',
      cli: '--property',
      description: 'Shader-defined property name (e.g. "_BaseColor", "_Smoothness", "_BaseMap"). Use inspect-material to discover the real names. Mutually exclusive with --keyword.',
    },
    value: {
      type: 'any',
      cli: '--value',
      description: 'Value matching the property type. Color: `{"r":1,"g":0,"b":0,"a":1}`. Vector: `{"x":1,"y":0,"z":0,"w":0}`. Float/Range: bare number. Texture: `{"assetRef":"Assets/Textures/X.png"}`. Required with --property.',
    },
    keyword: {
      type: 'string',
      cli: '--keyword',
      description: 'Shader keyword to toggle (e.g. "_EMISSION", "_NORMALMAP"). Mutually exclusive with --property.',
    },
    enable: {
      type: 'boolean',
      cli: '--enable',
      description: 'true to enable the keyword, false to disable. Defaults to true. Only meaningful with --keyword.',
    },
  },
  constraints: [
    { rule: 'atLeastOne', fields: ['assetPath', 'guid'] },
    { rule: 'oneOf', fields: ['property', 'keyword'] },
  ],
  result: {
    type: 'object',
    fields: {
      set: { type: 'boolean' },
      property: { type: 'string' },
      keyword: { type: 'string' },
      enabled: { type: 'boolean' },
    },
  },
  examples: [
    {
      title: 'Set a Color property',
      cli: './bin/dreamer set-material-property --asset Assets/Materials/PlayerMat.mat --property _BaseColor --value \'{"r":1,"g":0,"b":0,"a":1}\' --wait',
      args: { assetPath: 'Assets/Materials/PlayerMat.mat', property: '_BaseColor', value: { r: 1, g: 0, b: 0, a: 1 } },
    },
    {
      title: 'Set a Float property',
      cli: './bin/dreamer set-material-property --asset Assets/Materials/PlayerMat.mat --property _Smoothness --value 0.5 --wait',
      args: { assetPath: 'Assets/Materials/PlayerMat.mat', property: '_Smoothness', value: 0.5 },
    },
    {
      title: 'Assign a Texture',
      cli: './bin/dreamer set-material-property --asset Assets/Materials/PlayerMat.mat --property _BaseMap --value \'{"assetRef":"Assets/Textures/Player.png"}\' --wait',
      args: { assetPath: 'Assets/Materials/PlayerMat.mat', property: '_BaseMap', value: { assetRef: 'Assets/Textures/Player.png' } },
    },
    {
      title: 'Toggle a shader keyword on',
      cli: './bin/dreamer set-material-property --asset Assets/Materials/PlayerMat.mat --keyword _EMISSION --enable true --wait',
      args: { assetPath: 'Assets/Materials/PlayerMat.mat', keyword: '_EMISSION', enable: true },
    },
  ],
};
