'use strict';

const { commonArgs } = require('./_common');

module.exports = {
  kind: 'rename_gameobject',
  summary: 'Rename a GameObject (scene or inside a prefab) — or rename a non-prefab asset file. CLI verb: `rename`. USE THIS instead of `set-property --property m_Name`, which fails because m_Name lives on the GameObject anchor, not a Component.',
  requirements: null,
  args: {
    ...commonArgs.target(),
    newName: {
      type: 'string',
      required: true,
      cli: '--name',
      description: 'New name.',
    },
  },
  constraints: [commonArgs.targetAtLeastOne()],
  result: {
    type: 'object',
    fields: {
      renamed: { type: 'boolean' },
      oldName: { type: 'string' },
      newName: { type: 'string' },
      path: { type: 'string', description: 'Updated scene path (scene mode).' },
    },
  },
  examples: [
    {
      title: 'Rename a scene GameObject',
      cli: './bin/dreamer rename --scene-object "/UICanvas/TempName" --name "FinalName" --wait',
      args: { sceneObjectPath: '/UICanvas/TempName', newName: 'FinalName' },
    },
    {
      title: 'Rename a prefab root',
      cli: './bin/dreamer rename --asset Assets/Prefabs/OldName.prefab --name NewName --wait',
      args: { assetPath: 'Assets/Prefabs/OldName.prefab', newName: 'NewName' },
    },
    {
      title: 'Rename a child inside a prefab',
      cli: './bin/dreamer rename --asset Assets/Prefabs/Enemy.prefab --child-path "Visuals/Body" --name "Torso" --wait',
      args: { assetPath: 'Assets/Prefabs/Enemy.prefab', childPath: 'Visuals/Body', newName: 'Torso' },
    },
  ],
};
