'use strict';

module.exports = {
  kind: 'find_assets',
  summary: 'Search the Unity project for assets by type, name pattern, or folder.',
  requirements: null,
  args: {
    type: {
      type: 'string',
      description: 'Asset type filter: "prefab", "script", "scene", "material", "texture", or "any".',
      enum: ['prefab', 'script', 'scene', 'material', 'texture', 'any'],
    },
    name: {
      type: 'string',
      description: 'Name pattern; supports * wildcards (e.g. "Player*").',
    },
    path: {
      type: 'string',
      description: 'Limit search to this folder (e.g. "Assets/Prefabs").',
    },
  },
  result: {
    type: 'object',
    fields: {
      assets: { type: 'array', description: 'Array of { path, guid, type, name } entries.' },
      count: { type: 'number' },
    },
  },
  examples: [
    { args: { type: 'prefab' }, note: 'All prefabs in the project.' },
    { args: { type: 'script', name: 'Player*', path: 'Assets/Scripts' } },
  ],
};
