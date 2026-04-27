'use strict';

module.exports = {
  kind: 'set_app_id',
  summary:
    "Set the per-platform application identifier (bundle id). CLI verb: `set-app-id`. " +
    "Uses `PlayerSettings.SetApplicationIdentifier(NamedBuildTarget, string)` so each platform " +
    "(Standalone, Android, iOS, WebGL, …) keeps its own value. To set the same id everywhere, " +
    "call once per --target. Format: reverse-DNS, e.g. `com.example.myapp`.",
  requirements: null,
  args: {
    target: {
      type: 'string',
      required: true,
      cli: '--target',
      enum: ['standalone', 'android', 'ios', 'webgl', 'tvos', 'windowsstore', 'ps4', 'ps5', 'xboxone', 'switch'],
    },
    id: { type: 'string', required: true, cli: '--id', description: 'Bundle/application identifier (reverse-DNS).' },
  },
  result: {
    type: 'object',
    fields: { target: { type: 'string' }, previousId: { type: 'string' }, id: { type: 'string' } },
  },
  examples: [
    {
      title: 'Set Android bundle id',
      cli: './bin/dreamer set-app-id --target android --id com.example.myapp --wait',
      args: { target: 'android', id: 'com.example.myapp' },
    },
  ],
};
