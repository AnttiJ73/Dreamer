'use strict';

module.exports = {
  kind: 'set_build_scenes',
  summary:
    "Replace the entire EditorBuildSettings.scenes list. CLI verb: `set-build-scenes`. " +
    "Order in the array becomes the build index (used by `SceneManager.LoadScene(int)`). " +
    "Use add-build-scene / remove-build-scene for incremental edits.",
  requirements: null,
  args: {
    scenes: {
      type: 'array',
      required: true,
      cli: '--scenes',
      description:
        'JSON array. Each item is either a string path (`"Assets/Scenes/Main.unity"`, enabled by default) ' +
        'or an object `{path: "...", enabled: true|false}`.',
    },
  },
  result: { type: 'object', fields: { count: { type: 'integer' }, set: { type: 'boolean' } } },
  examples: [
    {
      title: 'Set 2 scenes, second disabled',
      cli: "./bin/dreamer set-build-scenes --scenes '[\"Assets/Scenes/Boot.unity\", {\"path\":\"Assets/Scenes/Test.unity\",\"enabled\":false}]' --wait",
      args: { scenes: ['Assets/Scenes/Boot.unity', { path: 'Assets/Scenes/Test.unity', enabled: false }] },
    },
  ],
  pitfalls: [
    'All scenes must already exist on disk — the command refuses if any path is missing.',
    'Disabled scenes still appear in the Build Settings UI but are excluded from the build (SceneManager can\'t load them by index).',
  ],
};
