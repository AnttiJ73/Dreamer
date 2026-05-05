'use strict';

module.exports = {
  kind: 'remove_build_scene',
  summary: "Remove a scene from EditorBuildSettings.scenes by path. CLI verb: `remove-build-scene`. No-op if not present.",
  requirements: null,
  args: {
    scene: { type: 'string', required: true, cli: '--scene' },
  },
  result: { type: 'object', fields: { scene: { type: 'string' }, removed: { type: 'boolean' }, removedAtIndex: { type: 'integer' }, note: { type: 'string' } } },
  examples: [
    { title: 'Remove a scene from the build', cli: './bin/dreamer remove-build-scene --scene Assets/Scenes/Level1.unity --wait', args: { scene: 'Assets/Scenes/Level1.unity' } },
  ],
};
