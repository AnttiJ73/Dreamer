'use strict';

module.exports = {
  kind: 'update_animator_transition',
  summary:
    "Update fields on an existing AnimatorStateTransition. CLI verb: `update-animator-transition`. " +
    "Identified by from + to + ordinal index. Only the fields you pass change; everything else is preserved. " +
    "Conditions are REPLACED wholesale when `--conditions` is given.",
  requirements: null,
  args: {
    assetPath: { type: 'string', cli: '--asset' },
    guid:      { type: 'string', cli: '--asset (GUID form)' },
    layer:     { type: 'integer', cli: '--layer' },
    from:      { type: 'string', cli: '--from' },
    to:        { type: 'string', cli: '--to' },
    index:     { type: 'integer', cli: '--index', description: 'Ordinal among matching transitions. Default 0.' },
    hasExitTime: { type: 'boolean', cli: '--has-exit-time' },
    exitTime:  { type: 'number', cli: '--exit-time' },
    duration:  { type: 'number', cli: '--duration' },
    offset:    { type: 'number', cli: '--offset' },
    canTransitionToSelf: { type: 'boolean', cli: '--can-self' },
    interruptionSource: {
      type: 'string',
      cli: '--interruption-source',
      enum: ['None', 'Source', 'Destination', 'SourceThenDestination', 'DestinationThenSource'],
      description: 'Whose conditions can interrupt this transition mid-blend.',
    },
    conditions: {
      type: 'array',
      cli: '--conditions',
      description: 'JSON array — REPLACES the whole condition list. Same shape as add-animator-transition.',
    },
  },
  constraints: [{ rule: 'atLeastOne', fields: ['assetPath', 'guid'] }],
  result: {
    type: 'object',
    fields: {
      updated: { type: 'boolean' },
      assetPath: { type: 'string' },
      from: { type: 'string' },
      to: { type: 'string' },
      changedFieldCount: { type: 'integer' },
      changedFields: { type: 'array' },
    },
  },
  examples: [
    {
      title: 'Increase Idle→Run blend duration',
      cli: './bin/dreamer update-animator-transition --asset Assets/Animators/PlayerCtl.controller --from Idle --to Run --duration 0.25 --wait',
      args: { assetPath: 'Assets/Animators/PlayerCtl.controller', from: 'Idle', to: 'Run', duration: 0.25 },
    },
    {
      title: 'Replace the condition list on AnyState→Jump',
      cli: './bin/dreamer update-animator-transition --asset Assets/Animators/PlayerCtl.controller --from AnyState --to Jump --conditions \'[{"parameter":"isJumping","mode":"If"},{"parameter":"isGrounded","mode":"IfNot"}]\' --wait',
      args: { assetPath: 'Assets/Animators/PlayerCtl.controller', from: 'AnyState', to: 'Jump', conditions: [{ parameter: 'isJumping', mode: 'If' }, { parameter: 'isGrounded', mode: 'IfNot' }] },
    },
  ],
  pitfalls: [
    'Conditions are replaced as a whole when --conditions is provided. To add or remove a single condition, inspect first, modify the list, then resubmit.',
  ],
};
