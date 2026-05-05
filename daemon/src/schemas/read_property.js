'use strict';

const { commonArgs } = require('./_common');

module.exports = {
  kind: 'read_property',
  summary: 'Read a serialized property value from a prefab component, scene-object component, or generic asset. Inverse of `set-property`. CLI verb: `read-property`.',
  requirements: null,
  args: {
    ...commonArgs.target(),
    componentType: {
      type: 'string',
      cli: '--component',
      description: 'Fully-qualified component type name (e.g. "Game.PlayerController" or "SpriteRenderer"). Optional — if omitted, the first non-Transform component is targeted.',
    },
    propertyPath: {
      type: 'string',
      required: true,
      cli: '--property',
      description: 'Field name. Same path syntax as set-property: dots for nested, brackets for arrays. Bare names map to Unity m_Pascal serialized fields automatically.',
    },
  },
  constraints: [commonArgs.targetAtLeastOne()],
  result: {
    type: 'object',
    fields: {
      value: { type: 'any', description: 'Property value as JSON. Primitives are bare. Vectors → {x,y,z[,w]}. Color → {r,g,b,a}. ObjectReference → {name, type, assetPath, instanceId}. Null when the field is unset.' },
      propertyType: { type: 'string', description: 'Unity SerializedPropertyType enum name (Integer, Float, Vector3, ObjectReference, ...).' },
      resolvedPath: { type: 'string', description: 'The actual SerializedProperty path used after alias resolution.' },
      componentType: { type: 'string' },
      assetPath: { type: 'string' },
      sceneObjectPath: { type: 'string' },
      childPath: { type: 'string' },
    },
  },
  examples: [
    {
      title: 'Read a transform position from a scene object',
      cli: './bin/dreamer read-property --scene-object "/Player" --component Transform --property m_LocalPosition --wait',
      args: { sceneObjectPath: '/Player', componentType: 'Transform', propertyPath: 'm_LocalPosition' },
    },
    {
      title: 'Read a custom field on a prefab\'s controller',
      cli: './bin/dreamer read-property --asset Assets/Prefabs/Player.prefab --component Game.PlayerController --property speed --wait',
      args: { assetPath: 'Assets/Prefabs/Player.prefab', componentType: 'Game.PlayerController', propertyPath: 'speed' },
    },
    {
      title: 'Read a sprite reference (returns {name, assetPath, ...})',
      cli: './bin/dreamer read-property --asset Assets/Prefabs/Enemy.prefab --child-path "Visuals" --component SpriteRenderer --property sprite --wait',
      args: { assetPath: 'Assets/Prefabs/Enemy.prefab', childPath: 'Visuals', componentType: 'SpriteRenderer', propertyPath: 'sprite' },
    },
    {
      title: 'Read a ScriptableObject field',
      cli: './bin/dreamer read-property --asset Assets/Data/EnemyData.asset --property baseHealth --wait',
      args: { assetPath: 'Assets/Data/EnemyData.asset', propertyPath: 'baseHealth' },
    },
  ],
  pitfalls: [
    'Property path syntax is identical to set-property — bare `sprite` resolves to `m_Sprite`, `entries[24]` resolves to `entries.Array.data[24]`.',
    'For an entire component\'s serialized fields, `inspect --include-fields --component <T>` is one call — don\'t loop read-property over every field.',
    'For BULK comparison (same property across N prefabs), `inspect-many --include-fields` is faster than N read-property calls.',
    'ObjectReference returns a SUMMARY object {name, type, assetPath, instanceId} — not the asset itself. To follow the reference, run `inspect` on its assetPath.',
  ],
};
