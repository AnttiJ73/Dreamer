'use strict';

module.exports = {
  kind: 'update_animator_state',
  summary:
    "Update fields on an existing AnimatorState. CLI verb: `update-animator-state`. " +
    "Only the fields you pass change; everything else is preserved. Useful for retuning speed, swapping the bound clip, or renaming.",
  requirements: null,
  args: {
    assetPath: { type: 'string', cli: '--asset' },
    guid:      { type: 'string', cli: '--asset (GUID form)' },
    layer:     { type: 'integer', cli: '--layer', description: 'Layer index. Default 0.' },
    name:      { type: 'string', cli: '--name', description: 'CURRENT state name (the lookup key).' },
    rename:    { type: 'string', cli: '--rename', description: 'New name. Optional. Must be unique on the layer.' },
    motion:    { type: 'string', cli: '--motion', description: 'New AnimationClip path. Pass empty string to clear motion.' },
    speed:     { type: 'number', cli: '--speed' },
    mirror:    { type: 'boolean', cli: '--mirror' },
    cycleOffset: { type: 'number', cli: '--cycle-offset' },
    writeDefaultValues: { type: 'boolean', cli: '--write-defaults' },
  },
  constraints: [{ rule: 'atLeastOne', fields: ['assetPath', 'guid'] }],
  result: {
    type: 'object',
    fields: {
      updated: { type: 'boolean' },
      assetPath: { type: 'string' },
      layer: { type: 'integer' },
      name: { type: 'string', description: 'Current name after the update (post-rename if applicable).' },
      changedFieldCount: { type: 'integer' },
      changedFields: { type: 'array' },
    },
  },
  examples: [
    {
      title: 'Speed up Run state',
      cli: './bin/dreamer update-animator-state --asset Assets/Animators/PlayerCtl.controller --name Run --speed 1.4 --wait',
      args: { assetPath: 'Assets/Animators/PlayerCtl.controller', name: 'Run', speed: 1.4 },
    },
    {
      title: 'Rename a state and swap its clip',
      cli: './bin/dreamer update-animator-state --asset Assets/Animators/PlayerCtl.controller --name Run --rename Sprint --motion Assets/Animations/Sprint.anim --wait',
      args: { assetPath: 'Assets/Animators/PlayerCtl.controller', name: 'Run', rename: 'Sprint', motion: 'Assets/Animations/Sprint.anim' },
    },
  ],
  pitfalls: [
    'If you rename, transitions referencing the old name update automatically (Unity tracks states by reference, not by name). However any external code calling `Animator.Play("Run")` would need updating.',
  ],
};
