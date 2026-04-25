'use strict';

module.exports = {
  kind: 'add_component',
  summary: 'Attach a Component (MonoBehaviour or built-in) to a prefab asset (root or any child) or a scene object.',
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
      description: 'Name or hierarchy path of a scene object instance, e.g. "Player" or "Parent/Child". CLI: --scene-object',
    },
    childPath: {
      type: 'string',
      cli: '--child-path',
      description: 'Target a NESTED GameObject inside the prefab (slash-separated path from the prefab root, e.g. "Visuals/Body"). Required when adding a component to a prefab child rather than the prefab root. CLI: --child-path',
    },
    typeName: {
      type: 'string',
      required: true,
      cli: '--type',
      description: 'Fully-qualified type name of the component to add, e.g. "Game.PlayerController" or "UnityEngine.Rigidbody". CLI: --type',
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
      childPath: { type: 'string', description: 'Set when attached to a nested child of a prefab.' },
    },
  },
  examples: [
    {
      title: 'Add component to a prefab root',
      cli: './bin/dreamer add-component --asset Assets/Prefabs/Player.prefab --type Game.PlayerController --wait',
      args: { assetPath: 'Assets/Prefabs/Player.prefab', typeName: 'Game.PlayerController' },
    },
    {
      title: 'Add component to a prefab CHILD via --child-path',
      cli: './bin/dreamer add-component --asset Assets/Prefabs/Enemy.prefab --child-path "Visuals/Body" --type UnityEngine.SpriteRenderer --wait',
      args: { assetPath: 'Assets/Prefabs/Enemy.prefab', childPath: 'Visuals/Body', typeName: 'UnityEngine.SpriteRenderer' },
    },
    {
      title: 'Add component to a scene object',
      cli: './bin/dreamer add-component --scene-object "Main Camera" --type UnityEngine.AudioListener --wait',
      args: { sceneObjectPath: 'Main Camera', typeName: 'UnityEngine.AudioListener' },
    },
  ],
};
