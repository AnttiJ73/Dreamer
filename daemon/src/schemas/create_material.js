'use strict';

module.exports = {
  kind: 'create_material',
  summary: 'Create a new Material asset under Assets/. CLI verb: `create-material`. Defaults to the project\'s pipeline-appropriate Lit shader (Standard / URP-Lit / HDRP-Lit) if --shader is omitted. Use set-material-property to configure properties afterward.',
  requirements: null,
  args: {
    name: {
      type: 'string',
      required: true,
      cli: '--name',
      description: 'Material asset name (no extension).',
    },
    path: {
      type: 'string',
      cli: '--path',
      description: 'Folder under Assets/. Defaults to "Assets/Materials".',
    },
    shader: {
      type: 'string',
      cli: '--shader',
      description: 'Shader name, e.g. "Universal Render Pipeline/Lit", "Standard", "Custom/MyShader". Default: pipeline-appropriate Lit.',
    },
  },
  result: {
    type: 'object',
    fields: {
      created: { type: 'boolean' },
      assetPath: { type: 'string' },
      shader: { type: 'string' },
    },
  },
  examples: [
    {
      title: 'Create a URP-Lit material',
      cli: './bin/dreamer create-material --name PlayerMat --path Assets/Materials --shader "Universal Render Pipeline/Lit" --wait',
      args: { name: 'PlayerMat', path: 'Assets/Materials', shader: 'Universal Render Pipeline/Lit' },
    },
  ],
};
