'use strict';

module.exports = {
  kind: 'rename_gameobject',
  summary: 'Rename a GameObject (scene or inside a prefab). USE THIS instead of `set-property --property m_Name`, which fails because m_Name lives on the GameObject anchor, not a Component.',
  requirements: null,
  args: {
    sceneObjectPath: {
      type: 'string',
      cli: '--scene-object',
      description: 'Path / name of the GameObject to rename (scene mode). CLI: --scene-object',
    },
    assetPath: {
      type: 'string',
      cli: '--asset',
      description: 'Path to a prefab asset (prefab mode — renames the prefab root, or a child if --child-path is given). For non-prefab assets (.asset/.mat/etc.) this renames the asset file via AssetDatabase.RenameAsset. CLI: --asset',
    },
    guid: {
      type: 'string',
      cli: '--asset (GUID form)',
      description: 'Asset GUID (alternative to assetPath). CLI: --asset',
    },
    childPath: {
      type: 'string',
      cli: '--child-path',
      description: 'When --asset is a prefab, the slash-separated path of the child to rename (relative to the prefab root). Omit to rename the prefab root. CLI: --child-path',
    },
    newName: {
      type: 'string',
      required: true,
      cli: '--name',
      description: 'New name. CLI: --name',
    },
  },
  constraints: [
    { rule: 'atLeastOne', fields: ['sceneObjectPath', 'assetPath', 'guid'] },
  ],
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
