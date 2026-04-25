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
      title: 'Sparse list update — append at index 24 without clobbering 0..23',
      cli: './bin/dreamer set-property --asset Assets/Data/Registry.asset --property entries --value \'{"_size":25,"24":{"id":"new","prefab":{"assetRef":"Assets/Prefabs/X.prefab"}}}\' --wait',
      args: { assetPath: 'Assets/Data/Registry.asset', propertyPath: 'entries', value: { _size: 25, 24: { id: 'new', prefab: { assetRef: 'Assets/Prefabs/X.prefab' } } } },
      note: 'Inspect the asset first to find the current length. Setting `entries[24]` directly fails for indices ≥ current length — Unity\'s FindProperty returns null for non-existent positions. The sparse form RESIZES and ASSIGNS atomically.',
    },
    {
      title: 'Update one element of an existing list (bracket shorthand for an existing index)',
      cli: './bin/dreamer set-property --asset Assets/Data/Registry.asset --property "entries[5].itemGuid" --value \'"new-guid"\' --wait',
      args: { assetPath: 'Assets/Data/Registry.asset', propertyPath: 'entries[5].itemGuid', value: 'new-guid' },
    },
    {
      title: 'Self-reference (sibling component on the same GameObject)',
      cli: './bin/dreamer set-property --scene-object "/Player" --component Game.HUDBinder --property controller --value \'{"self":true,"component":"PlayerController"}\' --wait',
      args: { sceneObjectPath: '/Player', componentType: 'Game.HUDBinder', propertyPath: 'controller', value: { self: true, component: 'PlayerController' } },
    },
    {
      title: 'Descendant component (selfChild — prefab-relative path)',
      cli: './bin/dreamer set-property --asset Assets/Prefabs/Player.prefab --component Game.PlayerController --property leftHandRenderer --value \'{"selfChild":"Visuals/LeftHand","component":"SpriteRenderer"}\' --wait',
      args: { assetPath: 'Assets/Prefabs/Player.prefab', componentType: 'Game.PlayerController', propertyPath: 'leftHandRenderer', value: { selfChild: 'Visuals/LeftHand', component: 'SpriteRenderer' } },
    },
    {
      title: 'Sub-asset (Sprite inside a sprite atlas — explicit subAsset to disambiguate)',
      cli: './bin/dreamer set-property --asset Assets/Prefabs/Player.prefab --child-path Body --component SpriteRenderer --property sprite --value \'{"assetRef":"Assets/Sprites/Characters.png","subAsset":"PlayerIdle_0"}\' --wait',
      args: { assetPath: 'Assets/Prefabs/Player.prefab', childPath: 'Body', componentType: 'SpriteRenderer', propertyPath: 'sprite', value: { assetRef: 'Assets/Sprites/Characters.png', subAsset: 'PlayerIdle_0' } },
    },
    {
      title: 'Clear a reference',
      cli: './bin/dreamer set-property --asset Assets/Prefabs/A.prefab --component Game.MyComponent --property target --value null --wait',
      args: { assetPath: 'Assets/Prefabs/A.prefab', componentType: 'Game.MyComponent', propertyPath: 'target', value: null },
    },
  ],
  pitfalls: [
    'DO NOT use this to rename a GameObject. `--property m_Name` returns a directive error pointing at `rename`. m_Name lives on the GameObject anchor, not a Component.',
    'Use a bare property name (e.g. `--property sprite`) for built-in Unity components — Dreamer auto-resolves to the m_Pascal form (`m_Sprite`). The result JSON\'s `resolvedPath` shows what was actually used.',
    'For a list APPEND past current length, you MUST use the sparse `{"_size":N+1,"N":...}` form. `entries[24]` fails for non-existent indices because Unity\'s FindProperty returns null.',
    'Passing a bare `entries: [...]` REPLACES the whole array. To leave existing elements untouched and update one, use the sparse form or bracket-indexed propertyPath (`entries[5]`).',
    'Materials don\'t serialize properties through standard fields — `set-property` won\'t reach them. Use `set-material-property` for `.mat` assets.',
    'When assigning a Sprite from a sprite atlas, pass `subAsset` to disambiguate. Without it Dreamer probes candidates and may error if multiple match.',
  ],
};
