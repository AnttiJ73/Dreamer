'use strict';

module.exports = {
  kind: 'create_script',
  summary: 'Create a C# script file under Assets/ and trigger Unity to compile it.',
  requirements: { compilation: true },
  args: {
    name: {
      type: 'string',
      required: true,
      description: 'Script class name (no extension). Becomes both the filename and the class name.',
    },
    namespace: {
      type: 'string',
      description: 'C# namespace for the class. Optional; omit for the global namespace.',
    },
    path: {
      type: 'string',
      description: 'Folder path relative to the project root, e.g. "Assets/Scripts". Defaults to "Assets/Scripts".',
    },
    template: {
      type: 'string',
      enum: ['monobehaviour', 'scriptableobject', 'editor', 'plain'],
      description: 'Script template. Defaults to "monobehaviour".',
    },
    content: {
      type: 'string',
      description: 'Custom script body (overrides the template entirely). Use for non-standard class shapes.',
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
    { args: { name: 'PlayerController', namespace: 'Game', path: 'Assets/Scripts' } },
    { args: { name: 'EnemyData', namespace: 'Game', template: 'scriptableobject' } },
  ],
};
