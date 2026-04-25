'use strict';

module.exports = {
  kind: 'save_as_prefab',
  summary: 'Save a scene GameObject (with all its components and descendants) as a NEW prefab asset on disk, and replace the scene object with a connected instance of the new prefab. CLI verb: `save-as-prefab`. NOTE: this regenerates fileIDs — references to the original scene object\'s components from elsewhere in the scene may break. Prefer create-hierarchy --save-path when starting fresh.',
  requirements: null,
  args: {
    sceneObjectPath: {
      type: 'string',
      required: true,
      cli: '--scene-object',
      description: 'Scene path of the GameObject to capture.',
    },
    savePath: {
      type: 'string',
      cli: '--path',
      description: 'Folder path under Assets/ where the prefab is saved. Defaults to "Assets/Prefabs".',
    },
    name: {
      type: 'string',
      cli: '--name',
      description: 'Override the prefab\'s asset name. Defaults to the scene object\'s name.',
    },
  },
  result: {
    type: 'object',
    fields: {
      saved: { type: 'boolean' },
      assetPath: { type: 'string' },
      guid: { type: 'string' },
    },
  },
  examples: [
    {
      title: 'Capture a configured scene object as a prefab',
      cli: './bin/dreamer save-as-prefab --scene-object "/Spawn/Player" --path Assets/Prefabs --name Player --wait',
      args: { sceneObjectPath: '/Spawn/Player', savePath: 'Assets/Prefabs', name: 'Player' },
    },
  ],
};
