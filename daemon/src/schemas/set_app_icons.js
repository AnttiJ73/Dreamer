'use strict';

module.exports = {
  kind: 'set_app_icons',
  summary:
    "Set per-platform application icons. CLI verb: `set-app-icons`. " +
    "Uses `PlayerSettings.SetIcons(NamedBuildTarget, Texture2D[], IconKind.Application)`. " +
    "Each platform expects a specific number of sizes — the result includes `expectedCount` so you can verify. " +
    "For just the Default Icon slot use `set-default-icon` (single texture).",
  requirements: null,
  args: {
    target: {
      type: 'string',
      required: true,
      cli: '--target',
      enum: ['default', 'standalone', 'android', 'ios', 'webgl', 'tvos', 'windowsstore', 'ps4', 'ps5', 'xboxone', 'switch'],
    },
    textures: {
      type: 'array',
      required: true,
      cli: '--textures',
      description: 'JSON array of Texture2D asset paths, ordered largest-to-smallest as Unity expects for the target.',
    },
  },
  result: {
    type: 'object',
    fields: {
      target: { type: 'string' },
      count: { type: 'integer' },
      expectedCount: { type: 'integer' },
      warning: { type: 'string', description: 'Present when count != expectedCount; Unity pads/truncates silently.' },
    },
  },
  examples: [
    {
      title: 'Set Android icons (multiple sizes)',
      cli: "./bin/dreamer set-app-icons --target android --textures '[\"Assets/Icons/192.png\",\"Assets/Icons/144.png\",\"Assets/Icons/96.png\"]' --wait",
      args: { target: 'android', textures: ['Assets/Icons/192.png', 'Assets/Icons/144.png', 'Assets/Icons/96.png'] },
    },
  ],
};
