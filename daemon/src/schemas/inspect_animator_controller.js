'use strict';

module.exports = {
  kind: 'inspect_animator_controller',
  summary:
    "Read an AnimatorController's parameters, layers, states, and transitions. CLI verb: " +
    "`inspect-animator-controller`. Use before modifying — names + types must match exactly " +
    "in subsequent add/set commands. Returns one entry per parameter and per (state, transition).",
  requirements: null,
  args: {
    assetPath: { type: 'string', cli: '--asset' },
    guid: { type: 'string', cli: '--asset (GUID form)' },
  },
  constraints: [
    { rule: 'atLeastOne', fields: ['assetPath', 'guid'] },
  ],
  result: {
    type: 'object',
    fields: {
      assetPath: { type: 'string' },
      name: { type: 'string' },
      parameterCount: { type: 'integer' },
      parameters: { type: 'array', description: 'Each: { name, type, default }.' },
      layerCount: { type: 'integer' },
      layers: { type: 'array', description: 'Each: { index, name, defaultState, stateCount, states[], transitions[] }.' },
    },
  },
  examples: [
    {
      title: 'Inspect the player controller',
      cli: './bin/dreamer inspect-animator-controller --asset Assets/Animators/PlayerCtl.controller --wait',
      args: { assetPath: 'Assets/Animators/PlayerCtl.controller' },
    },
  ],
  pitfalls: [
    'Run this whenever you\'re about to modify a controller — state names + parameter names are case-sensitive identifiers used by every other animator command.',
    'Sub-state machines and blend trees are not exposed in v1. If a state shows `motion: null` but is named like a blend tree, it likely has hidden authoring you can\'t edit via CLI.',
  ],
};
