'use strict';

module.exports = {
  kind: 'shader_status',
  summary: 'Report shader compile errors / warnings via ShaderUtil.GetShaderMessages. CLI verb: `shader-status`. With --asset: one shader. Without: project-wide scan, returns every user shader that has messages.',
  requirements: null,
  args: {
    assetPath: {
      type: 'string',
      cli: '--asset',
      description: 'Path to a .shader / .shadergraph asset.',
    },
    guid: {
      type: 'string',
      cli: '--asset (GUID form)',
      description: 'Shader GUID.',
    },
  },
  result: {
    type: 'object',
    fields: {
      shaders: { type: 'array', description: 'Each: { assetPath, name, errors: [...], warnings: [...] }.' },
      total: { type: 'integer' },
    },
  },
  examples: [
    {
      title: 'Single shader',
      cli: './bin/dreamer shader-status --asset Assets/Shaders/MyEffect.shader --wait',
      args: { assetPath: 'Assets/Shaders/MyEffect.shader' },
    },
    {
      title: 'Project-wide scan',
      cli: './bin/dreamer shader-status --wait',
      args: {},
    },
  ],
};
