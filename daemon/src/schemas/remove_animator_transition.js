'use strict';

module.exports = {
  kind: 'remove_animator_transition',
  summary:
    "Remove one transition from an AnimatorController. CLI verb: `remove-animator-transition`. " +
    "Transitions are identified by source + destination + ordinal (multiple transitions between the same pair of states are common — different conditions for OR semantics).",
  requirements: null,
  args: {
    assetPath: { type: 'string', cli: '--asset' },
    guid:      { type: 'string', cli: '--asset (GUID form)' },
    layer:     { type: 'integer', cli: '--layer', description: 'Layer index. Default 0.' },
    from:      { type: 'string', cli: '--from', description: 'Source state name, or `AnyState`.' },
    to:        { type: 'string', cli: '--to', description: 'Destination state name, or `Exit`.' },
    index:     { type: 'integer', cli: '--index', description: 'Ordinal among transitions matching from→to. Default 0 (first match).' },
  },
  constraints: [{ rule: 'atLeastOne', fields: ['assetPath', 'guid'] }],
  result: {
    type: 'object',
    fields: {
      removed: { type: 'boolean' },
      assetPath: { type: 'string' },
      layer: { type: 'integer' },
      from: { type: 'string' },
      to: { type: 'string' },
      index: { type: 'integer' },
    },
  },
  examples: [
    {
      title: 'Remove the first Idle→Run transition',
      cli: './bin/dreamer remove-animator-transition --asset Assets/Animators/PlayerCtl.controller --from Idle --to Run --wait',
      args: { assetPath: 'Assets/Animators/PlayerCtl.controller', from: 'Idle', to: 'Run' },
    },
    {
      title: 'Remove the second Idle→Run transition (different conditions)',
      cli: './bin/dreamer remove-animator-transition --asset Assets/Animators/PlayerCtl.controller --from Idle --to Run --index 1 --wait',
      args: { assetPath: 'Assets/Animators/PlayerCtl.controller', from: 'Idle', to: 'Run', index: 1 },
    },
  ],
  pitfalls: [
    'Use `inspect-animator-controller` first to confirm ordinals — `transitions[]` lists every transition in source-iteration order. The Nth match of from→to (0-indexed) is what `--index N` removes.',
  ],
};
