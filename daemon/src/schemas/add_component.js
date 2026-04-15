'use strict';

module.exports = {
  kind: 'add_component',
  summary: 'Attach a Component (MonoBehaviour or built-in) to a prefab asset or scene object.',
  requirements: { compilation: true },
  args: {
    asset: {
      type: 'string',
      description: 'Path to a prefab asset, e.g. "Assets/Prefabs/Player.prefab".',
    },
    sceneObject: {
      type: 'string',
      description: 'Name or hierarchy path of a scene object instance, e.g. "Player" or "Parent/Child".',
    },
    type: {
      type: 'string',
      required: true,
      description: 'Fully-qualified type name of the component to add, e.g. "Game.PlayerController" or "UnityEngine.Rigidbody".',
    },
  },
  constraints: [
    { rule: 'exactlyOne', fields: ['asset', 'sceneObject'] },
  ],
  result: {
    type: 'object',
    fields: {
      componentType: { type: 'string', description: 'The resolved type name that was attached.' },
      target: { type: 'string', description: 'Asset path or scene object path that received the component.' },
    },
  },
  examples: [
    { args: { asset: 'Assets/Prefabs/Player.prefab', type: 'Game.PlayerController' } },
    { args: { sceneObject: 'Main Camera', type: 'UnityEngine.AudioListener' } },
  ],
};
