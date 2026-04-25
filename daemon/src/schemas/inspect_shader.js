'use strict';

module.exports = {
  kind: 'inspect_shader',
  summary: 'Describe a shader\'s declared interface: properties (name + type + range), keywords, render queue, default state. CLI verb: `inspect-shader`. Use this to discover the property names you\'ll pass to set-material-property without bouncing through a Material.',
  requirements: null,
  args: {
    shader: {
      type: 'string',
      cli: '--shader',
      description: 'Shader name as Unity registers it, e.g. "Universal Render Pipeline/Lit".',
    },
    assetPath: {
      type: 'string',
      cli: '--asset',
      description: 'Path to a .shader / .shadergraph file (alternative to --shader).',
    },
    guid: {
      type: 'string',
      cli: '--asset (GUID form)',
      description: 'Shader GUID — alternative to assetPath.',
    },
  },
  constraints: [{ rule: 'atLeastOne', fields: ['shader', 'assetPath', 'guid'] }],
  result: {
    type: 'object',
    fields: {
      shader: { type: 'string' },
      properties: { type: 'array', description: 'Each: { name, displayName, type, value, range? }.' },
      keywords: { type: 'array' },
      renderQueue: { type: 'integer' },
    },
  },
  examples: [
    {
      title: 'Inspect a built-in shader by name',
      cli: './bin/dreamer inspect-shader --shader "Universal Render Pipeline/Lit" --wait',
      args: { shader: 'Universal Render Pipeline/Lit' },
    },
    {
      title: 'Inspect a custom shader by file',
      cli: './bin/dreamer inspect-shader --asset Assets/Shaders/MyEffect.shader --wait',
      args: { assetPath: 'Assets/Shaders/MyEffect.shader' },
    },
  ],
};
