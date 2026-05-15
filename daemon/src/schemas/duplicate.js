'use strict';

const { commonArgs } = require('./_common');

module.exports = {
  kind: 'duplicate',
  summary: 'Duplicate a GameObject (scene) or asset file (prefab/material/.asset). CLI verb: `duplicate`. Scene mode copies the GO and its descendants in place; asset mode copies the file under a new name.',
  requirements: null,
  args: {
    ...commonArgs.target(['asset', 'guid', 'scene', 'child']),
    newName: {
      type: 'string',
      cli: '--name',
      description: 'Name of the duplicate. Defaults to "<original>_Copy".',
    },
    savePath: {
      type: 'string',
      cli: '--save-path',
      description: 'Destination folder under Assets/ or Packages/ (asset mode only). Defaults to the source folder. Scene mode ignores this — duplicates land next to the source GameObject.',
    },
  },
  constraints: [commonArgs.targetAtLeastOne()],
  result: {
    type: 'object',
    fields: {
      duplicated: { type: 'boolean' },
      sourcePath: { type: 'string' },
      newPath: { type: 'string' },
      guid: { type: 'string', description: 'New GUID (asset mode).' },
    },
  },
  examples: [
    {
      title: 'Duplicate a scene GameObject',
      cli: './bin/dreamer duplicate --scene-object "/Spawn/Pickup" --name "PickupCopy" --wait',
      args: { sceneObjectPath: '/Spawn/Pickup', newName: 'PickupCopy' },
    },
    {
      title: 'Duplicate a prefab asset',
      cli: './bin/dreamer duplicate --asset Assets/Prefabs/Player.prefab --name PlayerVariant --wait',
      args: { assetPath: 'Assets/Prefabs/Player.prefab', newName: 'PlayerVariant' },
    },
  ],
};
