'use strict';

module.exports = {
  kind: 'create_prefab',
  summary: 'Create an empty prefab asset under Assets/ (no components, just a named GameObject root). Use create-hierarchy --save-path to create a prefab with a structured hierarchy + components in one call.',
  requirements: null,
  args: {
    name: {
      type: 'string',
      required: true,
      cli: '--name',
      description: 'Prefab name (no extension). Becomes the filename.',
    },
    path: {
      type: 'string',
      cli: '--path',
      description: 'Folder path relative to the project root, e.g. "Assets/Prefabs". Defaults to "Assets/Prefabs".',
    },
  },
  result: {
    type: 'object',
    fields: {
      path: { type: 'string', description: 'Absolute asset path of the created prefab.' },
      guid: { type: 'string', description: 'Unity asset GUID.' },
    },
  },
  examples: [
    {
      title: 'Create an empty prefab',
      cli: './bin/dreamer create-prefab --name Player --path Assets/Prefabs --wait',
      args: { name: 'Player', path: 'Assets/Prefabs' },
    },
  ],
};
