'use strict';

module.exports = {
  kind: 'set_animator_override_clip',
  summary:
    "Override a specific AnimationClip in an AnimatorOverrideController. CLI verb: `set-animator-override-clip`. " +
    "Single override: `--base-clip ORIG --override-clip NEW`. Batch: `--overrides JSON`.",
  requirements: null,
  args: {
    assetPath: { type: 'string', cli: '--asset' },
    guid:      { type: 'string', cli: '--asset (GUID form)' },
    baseClip:     { type: 'string', cli: '--base-clip', description: 'Either the clip name (matches AnimationClip.name) OR an asset path. The clip in the BASE controller you want to swap out.' },
    overrideClip: { type: 'string', cli: '--override-clip', description: 'Path to the new AnimationClip. Pass empty string to clear an existing override.' },
    overrides: {
      type: 'array',
      cli: '--overrides',
      description: 'Batch form: JSON array of `{baseClip:"...", overrideClip:"..."}` entries. Mutually exclusive with single-override flags.',
    },
  },
  constraints: [{ rule: 'atLeastOne', fields: ['assetPath', 'guid'] }],
  result: {
    type: 'object',
    fields: {
      set: { type: 'boolean' },
      assetPath: { type: 'string' },
      appliedCount: { type: 'integer', description: 'Number of overrides actually applied (matched by name/path).' },
      requestedCount: { type: 'integer' },
    },
  },
  examples: [
    {
      title: 'Swap the Idle clip for an enemy variant',
      cli: './bin/dreamer set-animator-override-clip --asset Assets/Animators/EnemyArcher.overrideController --base-clip Idle --override-clip Assets/Animations/Archer_Idle.anim --wait',
      args: { assetPath: 'Assets/Animators/EnemyArcher.overrideController', baseClip: 'Idle', overrideClip: 'Assets/Animations/Archer_Idle.anim' },
    },
    {
      title: 'Batch-override several clips at once',
      cli: './bin/dreamer set-animator-override-clip --asset Assets/Animators/EnemyArcher.overrideController --overrides \'[{"baseClip":"Idle","overrideClip":"Assets/Animations/Archer_Idle.anim"},{"baseClip":"Run","overrideClip":"Assets/Animations/Archer_Run.anim"}]\' --wait',
      args: { assetPath: 'Assets/Animators/EnemyArcher.overrideController', overrides: [{ baseClip: 'Idle', overrideClip: 'Assets/Animations/Archer_Idle.anim' }, { baseClip: 'Run', overrideClip: 'Assets/Animations/Archer_Run.anim' }] },
    },
  ],
  pitfalls: [
    '`baseClip` matches by AnimationClip.name first, then by asset path. If the base controller has two states bound to clips with the same name, both are overridden.',
    'Pass `--override-clip ""` (empty) to clear a previously-set override — the slot reverts to the base clip.',
  ],
};
