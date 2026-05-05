'use strict';

module.exports = {
  kind: 'inspect_build_scenes',
  summary: "List the scenes in EditorBuildSettings.scenes (the Build Settings → Scenes In Build list). CLI verb: `inspect-build-scenes`.",
  requirements: null,
  args: {},
  result: {
    type: 'object',
    fields: {
      count: { type: 'integer' },
      scenes: { type: 'array', description: 'Each item: `{index, path, enabled, guid}`. Build index is the position; disabled scenes still get a `buildIndex` of -1 at runtime.' },
    },
  },
  examples: [
    { title: 'Show current build scenes', cli: './bin/dreamer inspect-build-scenes', args: {} },
  ],
};
