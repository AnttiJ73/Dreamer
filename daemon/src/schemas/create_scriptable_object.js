'use strict';

module.exports = {
  kind: 'create_scriptable_object',
  summary: 'Create an instance of a ScriptableObject subclass and save it as a .asset file under Assets/. CLI verb: `create-scriptable-object`. Auto-waits for compilation. Edit fields afterward with set-property using --asset on the .asset path.',
  requirements: { compilation: true },
  args: {
    typeName: {
      type: 'string',
      required: true,
      cli: '--type',
      description: 'Fully-qualified type name of the ScriptableObject subclass, e.g. "Game.EnemyData".',
    },
    name: {
      type: 'string',
      required: true,
      cli: '--name',
      description: 'Asset name (no extension). Becomes the .asset filename.',
    },
    path: {
      type: 'string',
      cli: '--path',
      description: 'Folder path under Assets/ where the .asset is saved. Defaults to "Assets/Data".',
    },
  },
  result: {
    type: 'object',
    fields: {
      created: { type: 'boolean' },
      assetPath: { type: 'string' },
      guid: { type: 'string' },
    },
  },
  examples: [
    {
      title: 'Create a ScriptableObject instance',
      cli: './bin/dreamer create-scriptable-object --type Game.EnemyData --name Goblin --path Assets/Data/Enemies --wait',
      args: { typeName: 'Game.EnemyData', name: 'Goblin', path: 'Assets/Data/Enemies' },
    },
  ],
};
