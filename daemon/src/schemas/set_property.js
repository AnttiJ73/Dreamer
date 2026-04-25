'use strict';

const { commonArgs } = require('./_common');

module.exports = {
  kind: 'set_property',
  summary: 'Set a property or serialized field on a component attached to a prefab (root or any child) or scene object. NOTE: m_Name / name cannot be set this way — use the `rename` command. See `help conventions` → valueFormats for the full --value catalogue (refs, sub-assets, sparse arrays).',
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
      description: 'Field name. Nested paths use dots ("nested.inner"). Arrays use brackets ("entries[24]") — rewritten internally to Unity\'s "entries.Array.data[24]". Bare property names map to Unity m_Pascal serialized fields automatically (e.g. "sprite" → "m_Sprite"). To append past current length, use the {"_size":N,"<idx>":...} sparse form on --value.',
    },
    value: {
      type: 'any',
      required: true,
      cli: '--value',
      description: 'Value to assign. See `help conventions` → valueFormats for the full catalogue (primitives, vectors, asset/scene/sub-asset/self refs, sparse arrays, null to clear).',
    },
  },
  constraints: [commonArgs.targetAtLeastOne()],
  result: {
    type: 'object',
    fields: {
      before: { type: 'any' },
      after: { type: 'any' },
      resolvedPath: { type: 'string', description: 'The actual property path used (e.g. "m_Sprite" when you wrote "sprite").' },
    },
  },
  examples: [
    {
      title: 'Set a primitive on a prefab root component',
      cli: './bin/dreamer set-property --asset Assets/Prefabs/Player.prefab --component Game.PlayerController --property speed --value 10 --wait',
      args: { assetPath: 'Assets/Prefabs/Player.prefab', componentType: 'Game.PlayerController', propertyPath: 'speed', value: 10 },
    },
    {
      title: 'Set a property on a prefab CHILD via --child-path',
      cli: './bin/dreamer set-property --asset Assets/Prefabs/Enemy.prefab --child-path "Visuals/Body" --component SpriteRenderer --property color --value \'{"r":1,"g":0,"b":0,"a":1}\' --wait',
      args: { assetPath: 'Assets/Prefabs/Enemy.prefab', childPath: 'Visuals/Body', componentType: 'SpriteRenderer', propertyPath: 'color', value: { r: 1, g: 0, b: 0, a: 1 } },
    },
    {
      title: 'Asset reference (auto-resolves typed component fields)',
      cli: './bin/dreamer set-property --asset Assets/Prefabs/A.prefab --component Game.MyComponent --property target --value \'{"assetRef":"Assets/Prefabs/B.prefab"}\' --wait',
      args: { assetPath: 'Assets/Prefabs/A.prefab', componentType: 'Game.MyComponent', propertyPath: 'target', value: { assetRef: 'Assets/Prefabs/B.prefab' } },
    },
    {
      title: 'Scene object reference',
      cli: './bin/dreamer set-property --scene-object Player --component Game.PlayerController --property mainCamera --value \'{"sceneRef":"Main Camera"}\' --wait',
      args: { sceneObjectPath: 'Player', componentType: 'Game.PlayerController', propertyPath: 'mainCamera', value: { sceneRef: 'Main Camera' } },
    },
    {
      title: 'Sparse list update (append at index 24 without clobbering 0..23)',
      cli: './bin/dreamer set-property --asset Assets/Data/Registry.asset --property entries --value \'{"_size":25,"24":{"id":"new","prefab":{"assetRef":"Assets/Prefabs/X.prefab"}}}\' --wait',
      args: { assetPath: 'Assets/Data/Registry.asset', propertyPath: 'entries', value: { _size: 25, 24: { id: 'new', prefab: { assetRef: 'Assets/Prefabs/X.prefab' } } } },
    },
  ],
};
