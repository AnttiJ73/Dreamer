'use strict';

module.exports = {
  kind: 'set_material_shader',
  summary: 'Reassign a Material\'s shader. CLI verb: `set-material-shader`. Unity preserves compatible property values across the swap (matched by name + type); incompatible properties revert to defaults.',
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
      description: 'Material GUID.',
    },
    shader: {
      type: 'string',
      required: true,
      cli: '--shader',
      description: 'New shader name, e.g. "Universal Render Pipeline/Unlit".',
    },
  },
  constraints: [{ rule: 'atLeastOne', fields: ['assetPath', 'guid'] }],
  result: {
    type: 'object',
    fields: {
      set: { type: 'boolean' },
      oldShader: { type: 'string' },
      newShader: { type: 'string' },
    },
  },
  examples: [
    {
      title: 'Switch to URP-Unlit',
      cli: './bin/dreamer set-material-shader --asset Assets/Materials/PlayerMat.mat --shader "Universal Render Pipeline/Unlit" --wait',
      args: { assetPath: 'Assets/Materials/PlayerMat.mat', shader: 'Universal Render Pipeline/Unlit' },
    },
  ],
};
