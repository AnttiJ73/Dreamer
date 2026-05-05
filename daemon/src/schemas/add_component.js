'use strict';

const { commonArgs } = require('./_common');

module.exports = {
  kind: 'add_component',
  summary: 'Attach a Component (MonoBehaviour or built-in) to a prefab asset (root or any child) or a scene object. Auto-waits for compilation if .cs files have changed. Use --child-path to target a child within a prefab. See `help conventions` for target-form rules.',
  requirements: { compilation: true },
  args: {
    ...commonArgs.target(),
    typeName: {
      type: 'string',
      required: true,
      cli: '--type',
      description: 'Fully-qualified type name of the component to add, e.g. "Game.PlayerController" or "UnityEngine.Rigidbody".',
    },
  },
  constraints: [commonArgs.targetAtLeastOne()],
  result: {
    type: 'object',
    fields: {
      typeName: { type: 'string' },
      sceneObjectPath: { type: 'string' },
      assetPath: { type: 'string' },
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
    {
      title: 'Add a deeper-nested component (paths can have multiple segments)',
      cli: './bin/dreamer add-component --asset Assets/Prefabs/Boss.prefab --child-path "Visuals/Armor/Helm" --type UnityEngine.SpriteRenderer --wait',
      args: { assetPath: 'Assets/Prefabs/Boss.prefab', childPath: 'Visuals/Armor/Helm', typeName: 'UnityEngine.SpriteRenderer' },
    },
  ],
  pitfalls: [
    'YES, you can add a component to a prefab CHILD. Use `--child-path "RelPath"` together with `--asset PREFAB`. The same flag works on remove-component, set-property, reparent, rename, and delete-gameobject for prefab targets.',
    'If `--type` errors with "Type not found", that almost always means Unity hasn\'t compiled the .cs that defines the type. Check `compile-status` first; if `stale`, run `refresh-assets --wait` (auto-prepended for compile-gated commands when the watcher has seen .cs changes).',
    'Specify the FULLY-QUALIFIED type name including namespace: `Game.PlayerController`, NOT `PlayerController`. Built-in Unity types use their full namespace too: `UnityEngine.Rigidbody`, `UnityEngine.UI.Image`.',
    'NEVER work around "can\'t add to a prefab child" by instantiate-into-scene + save-as-prefab. That regenerates fileIDs and breaks references. Use --child-path.',
  ],
};
