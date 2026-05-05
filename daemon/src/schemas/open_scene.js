'use strict';

module.exports = {
  kind: 'open_scene',
  summary: 'Open an existing scene file in the Editor. CLI verb: `open-scene`. Pass --mode single to replace the active scene, or --mode additive to load alongside.',
  requirements: null,
  args: {
    path: {
      type: 'string',
      required: true,
      cli: '(positional)',
      description: 'Scene asset path. Passed positionally on the CLI: `dreamer open-scene "Assets/Scenes/Level1.unity"`.',
    },
    mode: {
      type: 'string',
      enum: ['single', 'additive'],
      cli: '--mode',
      description: 'Open mode. Default "single" (replaces the active scene, prompts if dirty).',
    },
  },
  result: {
    type: 'object',
    fields: {
      opened: { type: 'boolean' },
      scenePath: { type: 'string' },
      mode: { type: 'string' },
    },
  },
  examples: [
    {
      title: 'Open a scene (replaces active)',
      cli: './bin/dreamer open-scene "Assets/Scenes/Level1.unity" --wait',
      args: { path: 'Assets/Scenes/Level1.unity' },
    },
    {
      title: 'Open additively (alongside current)',
      cli: './bin/dreamer open-scene "Assets/Scenes/UI.unity" --mode additive --wait',
      args: { path: 'Assets/Scenes/UI.unity', mode: 'additive' },
    },
  ],
};
