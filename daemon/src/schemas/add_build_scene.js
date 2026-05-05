'use strict';

module.exports = {
  kind: 'add_build_scene',
  summary:
    "Append a scene to EditorBuildSettings.scenes if not already present. CLI verb: `add-build-scene`. " +
    "If the scene is already in the list, only the enabled flag is updated (no reordering).",
  requirements: null,
  args: {
    scene: { type: 'string', required: true, cli: '--scene', description: 'Asset path to the .unity scene file.' },
    enabled: { type: 'boolean', cli: '--enabled', description: 'Default true.' },
  },
  result: {
    type: 'object',
    fields: {
      scene: { type: 'string' },
      added: { type: 'boolean' },
      enabledUpdated: { type: 'boolean' },
      index: { type: 'integer' },
    },
  },
  examples: [
    {
      title: 'Add a level scene to the build',
      cli: './bin/dreamer add-build-scene --scene Assets/Scenes/Level1.unity --wait',
      args: { scene: 'Assets/Scenes/Level1.unity' },
    },
  ],
};
