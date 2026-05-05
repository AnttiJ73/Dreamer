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
    {
      title: 'Rename a non-prefab asset file (.asset, .mat, etc.)',
      cli: './bin/dreamer rename --asset Assets/Data/EnemyData_Old.asset --name EnemyData --wait',
      args: { assetPath: 'Assets/Data/EnemyData_Old.asset', newName: 'EnemyData' },
    },
  ],
  pitfalls: [
    'DO NOT try `set-property --property m_Name` to rename. m_Name lives on the GameObject anchor, not a Component, and set-property only routes through Components. The CLI now intercepts this with a directive error.',
    'For a child INSIDE a prefab, use `--asset PREFAB.prefab --child-path SUBPATH`, NOT `--scene-object`. Scene-object resolution doesn\'t reach into prefab assets.',
    'Renaming the prefab root file via `--asset Path.prefab --name NewName` renames BOTH the asset file AND the root GameObject inside. The path returned in the result reflects the new file location.',
    'After renaming a scene GameObject, any other reference using the OLD path will break. If you have set-property calls queued with the old path, update them.',
    '`newName` can contain spaces. Quote on the CLI: `--name "My Object"`. Names with `/` are NOT supported (they\'re parsed as path separators).',
    'After renaming in scene mode, `save-assets --wait` to persist — until then the .unity file shows no diff.',
  ],
};
