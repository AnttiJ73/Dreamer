'use strict';

module.exports = {
  kind: 'set_animator_default_state',
  summary:
    "Set the default state for an AnimatorController layer. CLI verb: `set-animator-default-state`. " +
    "The default state is the one Unity transitions to from Entry when the layer is first activated. " +
    "First state added to an empty layer auto-becomes default; use this command to override later.",
  requirements: null,
  args: {
    assetPath: { type: 'string', cli: '--asset' },
    guid: { type: 'string', cli: '--asset (GUID form)' },
    layer: { type: 'integer', cli: '--layer', description: 'Layer index. Default 0.' },
    state: { type: 'string', cli: '--state', description: 'State name (must already exist on the layer).' },
  },
  constraints: [
    { rule: 'atLeastOne', fields: ['assetPath', 'guid'] },
  ],
  result: {
    type: 'object',
    fields: {
      set: { type: 'boolean' },
      assetPath: { type: 'string' },
      layer: { type: 'integer' },
      defaultState: { type: 'string' },
    },
  },
  examples: [
    {
      title: 'Make Idle the default for layer 0',
      cli: './bin/dreamer set-animator-default-state --asset Assets/Animators/PlayerCtl.controller --state Idle --wait',
      args: { assetPath: 'Assets/Animators/PlayerCtl.controller', state: 'Idle' },
    },
  ],
  pitfalls: [
    'The state must exist on the specified layer. Run `inspect-animator-controller` to list state names if unsure.',
  ],
};
