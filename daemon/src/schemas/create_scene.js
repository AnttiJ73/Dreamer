'use strict';

module.exports = {
  kind: 'create_scene',
  summary: 'Create a new empty scene file. CLI verb: `create-scene`. Pass --set-active to make it the active scene immediately; otherwise it\'s saved on disk and the current scene stays active.',
  requirements: null,
  args: {
    name: {
      type: 'string',
      required: true,
      cli: '--name',
      description: 'Scene asset name (no .unity extension).',
    },
    path: {
      type: 'string',
      cli: '--path',
      description: 'Folder under Assets/. Defaults to "Assets/Scenes".',
    },
    setActive: {
      type: 'boolean',
      cli: '--set-active',
      description: 'When true, open the new scene in single mode immediately.',
    },
  },
  result: {
    type: 'object',
    fields: {
      created: { type: 'boolean' },
      assetPath: { type: 'string' },
    },
  },
  examples: [
    {
      title: 'Create and open a new scene',
      cli: './bin/dreamer create-scene --name Level1 --path Assets/Scenes --set-active true --wait',
      args: { name: 'Level1', path: 'Assets/Scenes', setActive: true },
    },
  ],
};
