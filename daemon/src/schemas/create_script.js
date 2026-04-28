'use strict';

module.exports = {
  kind: 'create_script',
  summary: 'Create a C# script file under Assets/ and trigger Unity to compile it. Auto-waits for compilation. Prefer this over writing .cs files directly when you want guaranteed import + import-classification + compile in one call.',
  requirements: { compilation: true },
  args: {
    name: {
      type: 'string',
      required: true,
      cli: '--name',
      description: 'Script class name (no extension). Becomes both the filename and the class name.',
    },
    namespace: {
      type: 'string',
      cli: '--namespace',
      description: 'C# namespace for the class. Omit for the global namespace.',
    },
    path: {
      type: 'string',
      cli: '--path',
      description: 'Folder path relative to the project root, e.g. "Assets/Scripts". Defaults to "Assets/Scripts". If a full file path ending in .cs is passed, the folder is taken as its parent and (if --name is omitted) the filename becomes the class name.',
    },
    template: {
      type: 'string',
      enum: ['monobehaviour', 'scriptableobject', 'editor', 'plain'],
      cli: '--template',
      description: 'Script template. Defaults to "monobehaviour". "plain" is a bare class with no Unity-specific scaffolding.',
    },
  },
  result: {
    type: 'object',
    fields: {
      path: { type: 'string', description: 'Absolute asset path of the created script.' },
      guid: { type: 'string', description: 'Unity asset GUID.' },
    },
  },
  examples: [
    {
      title: 'MonoBehaviour script',
      cli: './bin/dreamer create-script --name PlayerController --namespace Game --path Assets/Scripts --wait',
      args: { name: 'PlayerController', namespace: 'Game', path: 'Assets/Scripts' },
    },
    {
      title: 'ScriptableObject script',
      cli: './bin/dreamer create-script --name EnemyData --namespace Game --template scriptableobject --wait',
      args: { name: 'EnemyData', namespace: 'Game', template: 'scriptableobject' },
    },
  ],
};
