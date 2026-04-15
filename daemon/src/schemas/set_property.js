'use strict';

module.exports = {
  kind: 'set_property',
  summary: 'Set a property or serialized field on a component attached to a prefab or scene object.',
  requirements: null,
  args: {
    assetPath: {
      type: 'string',
      description: 'Path to a prefab asset, e.g. "Assets/Prefabs/Player.prefab".',
    },
    guid: {
      type: 'string',
      description: 'Asset GUID (alternative to assetPath).',
    },
    sceneObjectPath: {
      type: 'string',
      description: 'Name or hierarchy path of a scene object instance.',
    },
    childPath: {
      type: 'string',
      description: 'For nested GameObjects inside a prefab, the slash-separated path from the root.',
    },
    componentType: {
      type: 'string',
      description: 'Fully-qualified component type name (e.g. "Game.PlayerController"). Optional if the property is on the GameObject itself (e.g. "name", "layer").',
    },
    propertyPath: {
      type: 'string',
      required: true,
      description: 'Field name. May be a nested path for sub-objects. For arrays, use "fieldName[index]".',
    },
    value: {
      type: 'any',
      required: true,
      description: 'Value to assign. Primitives (number/string/bool) pass through; object references use { assetRef: "..." } / { sceneRef: "..." } / { guid: "..." }; null clears a reference.',
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
    },
  },
  examples: [
    { args: { assetPath: 'Assets/Prefabs/Player.prefab', componentType: 'Game.PlayerController', propertyPath: 'speed', value: 10 } },
    { args: { assetPath: 'Assets/Prefabs/A.prefab', componentType: 'Game.MyComponent', propertyPath: 'target', value: { assetRef: 'Assets/Prefabs/B.prefab' } } },
    { args: { sceneObjectPath: 'Player', componentType: 'Game.PlayerController', propertyPath: 'mainCamera', value: { sceneRef: 'Main Camera' } } },
  ],
};
