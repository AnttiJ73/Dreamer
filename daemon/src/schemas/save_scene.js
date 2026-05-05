'use strict';

module.exports = {
  kind: 'save_scene',
  summary: 'Save the active scene (or save-as to a path). CLI verb: `save-scene`. For most use cases prefer `save-assets`, which saves both scenes AND assets in one call.',
  requirements: null,
  args: {
    path: {
      type: 'string',
      cli: '--path',
      description: 'Optional save-as path under Assets/, e.g. "Assets/Scenes/MyScene.unity". Omit to save in place.',
    },
  },
  result: {
    type: 'object',
    fields: {
      saved: { type: 'boolean' },
      scenePath: { type: 'string' },
    },
  },
  examples: [
    {
      title: 'Save the active scene in place',
      cli: './bin/dreamer save-scene --wait',
      args: {},
    },
    {
      title: 'Save-as to a new path',
      cli: './bin/dreamer save-scene --path Assets/Scenes/Level1.unity --wait',
      args: { path: 'Assets/Scenes/Level1.unity' },
    },
  ],
};
