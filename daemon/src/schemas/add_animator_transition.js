'use strict';

module.exports = {
  kind: 'add_animator_transition',
  summary:
    "Add a transition between two AnimatorController states (or Any State → state, or state → Exit). " +
    "CLI verb: `add-animator-transition`. Conditions reference parameters added via `add-animator-parameter`.",
  requirements: null,
  args: {
    assetPath: { type: 'string', cli: '--asset' },
    guid: { type: 'string', cli: '--asset (GUID form)' },
    layer: { type: 'integer', cli: '--layer', description: 'Layer index. Default 0.' },
    from: {
      type: 'string',
      cli: '--from',
      description: 'Source state name, OR `AnyState` (the AnyState pseudo-source, fires from any state). `Entry` is NOT supported in v1 — wire the entry connection via `set-animator-default-state` instead.',
    },
    to: {
      type: 'string',
      cli: '--to',
      description: 'Destination state name, OR `Exit` to transition to the layer\'s exit node.',
    },
    hasExitTime: { type: 'boolean', cli: '--has-exit-time', description: 'If true, the transition only fires after exitTime is reached (normalized 0..1 of source clip duration). Default false.' },
    exitTime: { type: 'number', cli: '--exit-time', description: 'Normalized time threshold (0..1+) — only meaningful when hasExitTime=true. Default 0.9.' },
    duration: { type: 'number', cli: '--duration', description: 'Cross-fade duration in seconds (or normalized; default mode is fixed-duration in seconds). Default 0.1.' },
    offset: { type: 'number', cli: '--offset', description: 'Normalized offset into the destination state. Default 0.' },
    canTransitionToSelf: { type: 'boolean', cli: '--can-self', description: 'For AnyState transitions: allow the transition to fire when the source IS the destination. Default false.' },
    conditions: {
      type: 'array',
      cli: '--conditions',
      description:
        'JSON array of conditions. Each: `{ "parameter": "name", "mode": "If"|"IfNot"|"Greater"|"Less"|"Equals"|"NotEqual", "threshold"?: <number> }`. ' +
        'For Bool params: `If` (true) / `IfNot` (false), no threshold. For Trigger: `If`. For Float/Int: `Greater`/`Less`/`Equals`/`NotEqual` with threshold. ' +
        'No conditions = transition fires when exit-time is reached (or immediately, if hasExitTime=false).',
    },
  },
  constraints: [
    { rule: 'atLeastOne', fields: ['assetPath', 'guid'] },
  ],
  result: {
    type: 'object',
    fields: {
      added: { type: 'boolean' },
      assetPath: { type: 'string' },
      layer: { type: 'integer' },
      from: { type: 'string' },
      to: { type: 'string' },
      conditionCount: { type: 'integer' },
      duration: { type: 'number' },
      hasExitTime: { type: 'boolean' },
    },
  },
  examples: [
    {
      title: 'Idle → Walk when isMoving=true',
      cli: './bin/dreamer add-animator-transition --asset Assets/Animators/PlayerCtl.controller --from Idle --to Walk --conditions \'[{"parameter":"isMoving","mode":"If"}]\' --duration 0.15 --wait',
      args: { assetPath: 'Assets/Animators/PlayerCtl.controller', from: 'Idle', to: 'Walk', conditions: [{ parameter: 'isMoving', mode: 'If' }], duration: 0.15 },
    },
    {
      title: 'Walk → Idle when isMoving=false',
      cli: './bin/dreamer add-animator-transition --asset Assets/Animators/PlayerCtl.controller --from Walk --to Idle --conditions \'[{"parameter":"isMoving","mode":"IfNot"}]\' --wait',
      args: { assetPath: 'Assets/Animators/PlayerCtl.controller', from: 'Walk', to: 'Idle', conditions: [{ parameter: 'isMoving', mode: 'IfNot' }] },
    },
    {
      title: 'AnyState → Attack when attack trigger fires',
      cli: './bin/dreamer add-animator-transition --asset Assets/Animators/PlayerCtl.controller --from AnyState --to Attack --conditions \'[{"parameter":"attack","mode":"If"}]\' --wait',
      args: { assetPath: 'Assets/Animators/PlayerCtl.controller', from: 'AnyState', to: 'Attack', conditions: [{ parameter: 'attack', mode: 'If' }] },
    },
    {
      title: 'Attack → Idle after clip finishes (no condition, exit-time at 0.95)',
      cli: './bin/dreamer add-animator-transition --asset Assets/Animators/PlayerCtl.controller --from Attack --to Idle --has-exit-time true --exit-time 0.95 --duration 0.05 --wait',
      args: { assetPath: 'Assets/Animators/PlayerCtl.controller', from: 'Attack', to: 'Idle', hasExitTime: true, exitTime: 0.95, duration: 0.05 },
    },
    {
      title: 'Speed-driven blend: Walk → Run when speed > 5',
      cli: './bin/dreamer add-animator-transition --asset Assets/Animators/PlayerCtl.controller --from Walk --to Run --conditions \'[{"parameter":"speed","mode":"Greater","threshold":5}]\' --wait',
      args: { assetPath: 'Assets/Animators/PlayerCtl.controller', from: 'Walk', to: 'Run', conditions: [{ parameter: 'speed', mode: 'Greater', threshold: 5 }] },
    },
  ],
  pitfalls: [
    '`Entry` is NOT supported as a `from` value in v1 (entry transitions use a different Unity API and rarely add value over `set-animator-default-state`). Use `set-animator-default-state` to set the layer\'s default, which Unity treats as the implicit entry connection.',
    'No conditions + hasExitTime=false = the transition fires IMMEDIATELY after entering the source state. Almost never what you want — add at least one condition or set an exit time.',
    'Conditions with no threshold (Bool/Trigger): use mode `If` (true) or `IfNot` (false). Threshold is ignored for Bool/Trigger but required for Float/Int comparisons.',
    'Multiple conditions on one transition combine as logical AND. For OR semantics, add multiple transitions between the same states with different condition sets.',
    'Add parameters BEFORE referencing them in conditions. Unknown parameter names produce silent runtime no-ops (the condition just never evaluates true).',
  ],
};
