'use strict';

module.exports = {
  kind: 'remove_component',
  summary: 'Remove a Component from a prefab asset (root or any child) or a scene object.',
  requirements: { compilation: true },
  args: {
    assetPath: {
      type: 'string',
      cli: '--asset',
      description: 'Path to a prefab asset, e.g. "Assets/Prefabs/Player.prefab". CLI: --asset',
    },
    guid: {
      type: 'string',
      cli: '--asset (GUID form)',
      description: 'Asset GUID (alternative to assetPath; pass via --asset). CLI: --asset',
    },
    sceneObjectPath: {
      type: 'string',
      cli: '--scene-object',
      description: 'Name or hierarchy path of a scene object instance. CLI: --scene-object',
    },
    childPath: {
      type: 'string',
      cli: '--child-path',
      description: 'Target a NESTED GameObject inside the prefab (slash-separated path from the prefab root, e.g. "Visuals/Body"). Required when removing a component from a prefab child rather than the prefab root. CLI: --child-path',
    },
    typeName: {
      type: 'string',
      required: true,
      cli: '--type',
      description: 'Fully-qualified type name to remove, e.g. "UnityEngine.SpriteRenderer". Required components like Transform/RectTransform cannot be removed (Unity refuses). CLI: --type',
    },
  },
  constraints: [
    { rule: 'atLeastOne', fields: ['assetPath', 'guid', 'sceneObjectPath'] },
  ],
  result: {
    type: 'object',
    fields: {
      removed: { type: 'boolean' },
      typeName: { type: 'string' },
    },
  },
  examples: [
    {
      title: 'Remove component from a prefab root',
      cli: './bin/dreamer remove-component --asset Assets/Prefabs/Player.prefab --type UnityEngine.AudioListener --wait',
      args: { assetPath: 'Assets/Prefabs/Player.prefab', typeName: 'UnityEngine.AudioListener' },
    },
    {
      title: 'Remove component from a prefab CHILD via --child-path',
      cli: './bin/dreamer remove-component --asset Assets/Prefabs/Enemy.prefab --child-path "Visuals/Body" --type UnityEngine.SpriteRenderer --wait',
      args: { assetPath: 'Assets/Prefabs/Enemy.prefab', childPath: 'Visuals/Body', typeName: 'UnityEngine.SpriteRenderer' },
    },
    {
      title: 'Remove component from a scene object',
      cli: './bin/dreamer remove-component --scene-object "Player" --type Game.UnusedComponent --wait',
      args: { sceneObjectPath: 'Player', typeName: 'Game.UnusedComponent' },
    },
  ],
};
