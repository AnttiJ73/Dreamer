'use strict';

module.exports = {
  kind: 'instantiate_prefab',
  summary: 'Instantiate a prefab into the active scene as a connected prefab instance (preserves the prefab link). CLI verb: `instantiate-prefab`. To create a NEW prefab from a scene tree, see save-as-prefab. To build a hierarchy directly, see create-hierarchy.',
  requirements: null,
  args: {
    assetPath: {
      type: 'string',
      cli: '--asset',
      description: 'Path to the .prefab asset.',
    },
    guid: {
      type: 'string',
      cli: '--asset (GUID form)',
      description: 'Prefab GUID — alternative to assetPath; auto-detected when --asset value is 32 hex chars.',
    },
    name: {
      type: 'string',
      cli: '--name',
      description: 'Override the instance\'s name. Default: the prefab\'s asset name.',
    },
    parentPath: {
      type: 'string',
      cli: '--parent',
      description: 'Scene path of the parent to attach to. Empty / unset → scene root.',
    },
    position: {
      type: 'object',
      cli: '--position',
      description: 'World position as JSON `{"x":N,"y":N,"z":N}`. Defaults to (0, 0, 0).',
    },
    rotation: {
      type: 'object',
      cli: '--rotation',
      description: 'Euler-angle rotation as JSON `{"x":N,"y":N,"z":N}`.',
    },
  },
  constraints: [{ rule: 'atLeastOne', fields: ['assetPath', 'guid'] }],
  result: {
    type: 'object',
    fields: {
      name: { type: 'string' },
      instanceId: { type: 'integer' },
      path: { type: 'string', description: 'Resolved scene path of the instance.' },
      prefabPath: { type: 'string' },
      prefabGuid: { type: 'string' },
    },
  },
  examples: [
    {
      title: 'Instantiate at origin',
      cli: './bin/dreamer instantiate-prefab --asset Assets/Prefabs/Player.prefab --wait',
      args: { assetPath: 'Assets/Prefabs/Player.prefab' },
    },
    {
      title: 'Instantiate as a child of an existing scene object, with position',
      cli: './bin/dreamer instantiate-prefab --asset Assets/Prefabs/Pickup.prefab --parent /Pickups --position \'{"x":2,"y":0,"z":0}\' --wait',
      args: { assetPath: 'Assets/Prefabs/Pickup.prefab', parentPath: '/Pickups', position: { x: 2, y: 0, z: 0 } },
    },
  ],
};
