'use strict';

module.exports = {
  kind: 'find_assets',
  summary: 'Search the Unity project for assets by type, name pattern, or folder. Run this BEFORE referencing an asset by path to verify it exists. CLI verb: `find-assets`.',
  requirements: null,
  args: {
    type: {
      type: 'string',
      cli: '--type',
      enum: ['prefab', 'script', 'scene', 'material', 'texture', 'any'],
      description: 'Asset type filter. Defaults to "any".',
    },
    name: {
      type: 'string',
      cli: '--name',
      description: 'Name pattern; supports * wildcards (e.g. "Player*").',
    },
    path: {
      type: 'string',
      cli: '--path',
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
    {
      title: 'All prefabs in the project',
      cli: './bin/dreamer find-assets --type prefab --wait',
      args: { type: 'prefab' },
    },
    {
      title: 'Player-prefixed scripts in a specific folder',
      cli: './bin/dreamer find-assets --type script --name "Player*" --path Assets/Scripts --wait',
      args: { type: 'script', name: 'Player*', path: 'Assets/Scripts' },
    },
  ],
};
