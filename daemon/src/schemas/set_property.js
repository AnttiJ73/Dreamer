'use strict';

module.exports = {
  kind: 'set_property',
  summary: 'Set a property or serialized field on a component attached to a prefab or scene object.',
  requirements: null,
  args: {
    asset: {
      type: 'string',
      description: 'Path to a prefab asset, e.g. "Assets/Prefabs/Player.prefab".',
    },
    sceneObject: {
      type: 'string',
      description: 'Name or hierarchy path of a scene object instance.',
    },
    component: {
      type: 'string',
      description: 'Fully-qualified component type name (e.g. "Game.PlayerController"). Optional if the property is on the GameObject itself (e.g. "name", "layer").',
    },
    property: {
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
    { rule: 'exactlyOne', fields: ['asset', 'sceneObject'] },
  ],
  result: {
    type: 'object',
    fields: {
      before: { type: 'any', description: 'Previous value (best-effort, serialised).' },
      after: { type: 'any', description: 'New value (best-effort, serialised).' },
    },
  },
  examples: [
    { args: { asset: 'Assets/Prefabs/Player.prefab', component: 'Game.PlayerController', property: 'speed', value: 10 } },
    { args: { asset: 'Assets/Prefabs/A.prefab', component: 'Game.MyComponent', property: 'target', value: { assetRef: 'Assets/Prefabs/B.prefab' } } },
    { args: { sceneObject: 'Player', component: 'Game.PlayerController', property: 'mainCamera', value: { sceneRef: 'Main Camera' } } },
  ],
};
