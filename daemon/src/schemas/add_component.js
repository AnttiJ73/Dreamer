'use strict';

module.exports = {
  kind: 'add_component',
  summary: 'Attach a Component (MonoBehaviour or built-in) to a prefab asset or scene object.',
  requirements: { compilation: true },
  args: {
    assetPath: {
      type: 'string',
      description: 'Path to a prefab asset, e.g. "Assets/Prefabs/Player.prefab".',
    },
    guid: {
      type: 'string',
      description: 'Asset GUID (alternative to assetPath for prefab targets).',
    },
    sceneObjectPath: {
      type: 'string',
      description: 'Name or hierarchy path of a scene object instance, e.g. "Player" or "Parent/Child".',
    },
    childPath: {
      type: 'string',
      description: 'When targeting a nested GameObject inside the prefab, the slash-separated path from the root.',
    },
    typeName: {
      type: 'string',
      required: true,
      description: 'Fully-qualified type name of the component to add, e.g. "Game.PlayerController" or "UnityEngine.Rigidbody".',
    },
  },
  constraints: [
    { rule: 'atLeastOne', fields: ['assetPath', 'guid', 'sceneObjectPath'] },
  ],
  result: {
    type: 'object',
    fields: {
      typeName: { type: 'string', description: 'The resolved full type name that was attached.' },
      sceneObjectPath: { type: 'string', description: 'Set when attached to a scene object.' },
      assetPath: { type: 'string', description: 'Set when attached to a prefab asset.' },
    },
  },
  examples: [
    { args: { assetPath: 'Assets/Prefabs/Player.prefab', typeName: 'Game.PlayerController' } },
    { args: { sceneObjectPath: 'Main Camera', typeName: 'UnityEngine.AudioListener' } },
  ],
};
