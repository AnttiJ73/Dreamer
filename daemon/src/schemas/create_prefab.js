'use strict';

module.exports = {
  kind: 'create_prefab',
  summary: 'Create an empty prefab asset under Assets/ (no components, just a named GameObject root).',
  requirements: null,
  args: {
    name: {
      type: 'string',
      required: true,
      description: 'Prefab name (no extension). Becomes the filename.',
    },
    path: {
      type: 'string',
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
    { args: { name: 'Player', path: 'Assets/Prefabs' } },
  ],
};
