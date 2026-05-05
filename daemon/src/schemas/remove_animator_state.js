'use strict';

module.exports = {
  kind: 'remove_animator_state',
  summary:
    "Remove a state from an AnimatorController layer. CLI verb: `remove-animator-state`. " +
    "Outgoing transitions are removed automatically (Unity); incoming transitions from other states are " +
    "scrubbed from the source side as part of cleanup. The default state for the layer is reset if the " +
    "removed state was the default.",
  requirements: null,
  args: {
    assetPath: { type: 'string', cli: '--asset' },
    guid:      { type: 'string', cli: '--asset (GUID form)' },
    layer:     { type: 'integer', cli: '--layer', description: 'Layer index. Default 0.' },
    name:      { type: 'string', cli: '--name', description: 'State name to remove.' },
  },
  constraints: [{ rule: 'atLeastOne', fields: ['assetPath', 'guid'] }],
  result: {
    type: 'object',
    fields: {
      removed: { type: 'boolean' },
      assetPath: { type: 'string' },
      layer: { type: 'integer' },
      name: { type: 'string' },
      incomingTransitionsCleaned: { type: 'integer' },
      stateCount: { type: 'integer' },
    },
  },
  examples: [
    {
      title: 'Remove an obsolete state',
      cli: './bin/dreamer remove-animator-state --asset Assets/Animators/PlayerCtl.controller --name OldDash --wait',
      args: { assetPath: 'Assets/Animators/PlayerCtl.controller', name: 'OldDash' },
    },
  ],
  pitfalls: [
    'If the removed state was the layer default, the default falls back to whichever state Unity picks (typically the first remaining). Set explicitly via `set-animator-default-state`.',
  ],
};
