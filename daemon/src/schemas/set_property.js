'use strict';

module.exports = {
  kind: 'set_property',
  summary: 'Set a property or serialized field on a component attached to a prefab (root or any child) or scene object.',
  requirements: null,
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
      description: 'For nested GameObjects inside a prefab, the slash-separated path from the prefab root (e.g. "Visuals/Body"). Required when targeting a prefab child rather than the prefab root. CLI: --child-path',
    },
    componentType: {
      type: 'string',
      cli: '--component',
      description: 'Fully-qualified component type name (e.g. "Game.PlayerController" or "SpriteRenderer"). Optional — if omitted, the first non-Transform component is targeted. CLI: --component',
    },
    propertyPath: {
      type: 'string',
      required: true,
      cli: '--property',
      description: 'Field name. May be a nested path for sub-objects (e.g. "nested.inner"). For arrays/lists, use "fieldName[index]" — bracket form is rewritten internally to Unity\'s "fieldName.Array.data[index]". For appending past current length, use the {"_size": N, "<idx>": ...} sparse form on --value. NOTE: m_Name / name cannot be set via set-property — use the `rename` command instead. CLI: --property',
    },
    value: {
      type: 'any',
      required: true,
      cli: '--value',
      description: 'Value to assign. Primitives pass through; object refs use {"assetRef":"..."} / {"sceneRef":"..."} / {"guid":"..."} / {"self":true,"component":"..."} / {"selfChild":"sub","component":"..."}; null clears a reference. Arrays: [...] replaces fully, {"_size":N,"i":val} sparse-updates. CLI: --value',
    },
  },
  constraints: [
    { rule: 'atLeastOne', fields: ['assetPath', 'guid', 'sceneObjectPath'] },
  ],
  result: {
    type: 'object',
    fields: {
      before: { type: 'any', description: 'Previous value (best-effort, serialised).' },
      after: { type: 'any', description: 'New value (best-effort, serialised).' },
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
