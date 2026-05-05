'use strict';

const { commonArgs } = require('./_common');

module.exports = {
  kind: 'remove_component',
  summary: 'Remove a Component from a prefab asset (root or any child) or scene object. Auto-waits for compilation. Required components like Transform / RectTransform cannot be removed (Unity refuses).',
  requirements: { compilation: true },
  args: {
    ...commonArgs.target(),
    typeName: {
      type: 'string',
      required: true,
      cli: '--type',
      description: 'Fully-qualified type name to remove, e.g. "UnityEngine.SpriteRenderer".',
    },
  },
  constraints: [commonArgs.targetAtLeastOne()],
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
