'use strict';

module.exports = {
  kind: 'inspect_animator_override_controller',
  summary: "Read an AnimatorOverrideController's base and per-clip overrides. CLI verb: `inspect-animator-override-controller`.",
  requirements: null,
  args: {
    assetPath: { type: 'string', cli: '--asset' },
    guid:      { type: 'string', cli: '--asset (GUID form)' },
  },
  constraints: [{ rule: 'atLeastOne', fields: ['assetPath', 'guid'] }],
  result: {
    type: 'object',
    fields: {
      assetPath: { type: 'string' },
      name: { type: 'string' },
      base: { type: 'string', description: 'Path to the underlying base AnimatorController.' },
      clipCount: { type: 'integer' },
      overriddenCount: { type: 'integer' },
      overrides: {
        type: 'array',
        description: 'Each: { baseClip, baseClipPath, overrideClip, overrideClipPath, hasOverride }.',
      },
    },
  },
  examples: [
    {
      title: 'Show every override pair',
      cli: './bin/dreamer inspect-animator-override-controller --asset Assets/Animators/EnemyArcher.overrideController --wait',
      args: { assetPath: 'Assets/Animators/EnemyArcher.overrideController' },
    },
  ],
};
