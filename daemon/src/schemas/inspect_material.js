'use strict';

module.exports = {
  kind: 'inspect_material',
  summary: 'Read a Material\'s shader, every property (name, type, value, range), active keywords, and render queue. CLI verb: `inspect-material`. Run BEFORE set-material-property to discover real property names — they\'re shader-defined and look like _BaseColor / _Smoothness, NOT camelCase.',
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
      description: 'Material GUID — alternative to assetPath; auto-detected when --asset is 32 hex chars.',
    },
  },
  constraints: [{ rule: 'atLeastOne', fields: ['assetPath', 'guid'] }],
  result: {
    type: 'object',
    fields: {
      shader: { type: 'string' },
      properties: { type: 'array', description: 'Each: { name, type: "Color"|"Vector"|"Float"|"Range"|"Texture", value, range? }.' },
      keywords: { type: 'array', description: 'Active shader keyword strings.' },
      renderQueue: { type: 'integer' },
    },
  },
  examples: [
    {
      title: 'Inspect a material',
      cli: './bin/dreamer inspect-material --asset Assets/Materials/PlayerMat.mat --wait',
      args: { assetPath: 'Assets/Materials/PlayerMat.mat' },
    },
  ],
};
