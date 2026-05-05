'use strict';

module.exports = {
  kind: 'remove_animator_layer',
  summary:
    "Remove a layer from an AnimatorController. CLI verb: `remove-animator-layer`. " +
    "Layer 0 (the base layer) cannot be removed — every controller must have at least one layer.",
  requirements: null,
  args: {
    assetPath: { type: 'string', cli: '--asset' },
    guid:      { type: 'string', cli: '--asset (GUID form)' },
    layer:     { type: 'integer', cli: '--layer', description: 'Layer index (must be ≥ 1).' },
  },
  constraints: [{ rule: 'atLeastOne', fields: ['assetPath', 'guid'] }],
  result: {
    type: 'object',
    fields: {
      removed: { type: 'boolean' },
      assetPath: { type: 'string' },
      layerIndex: { type: 'integer' },
      name: { type: 'string' },
      layerCount: { type: 'integer' },
    },
  },
  examples: [
    {
      title: 'Remove an experimental layer',
      cli: './bin/dreamer remove-animator-layer --asset Assets/Animators/PlayerCtl.controller --layer 2 --wait',
      args: { assetPath: 'Assets/Animators/PlayerCtl.controller', layer: 2 },
    },
  ],
  pitfalls: [
    'Layer indices renumber after removal. If you remove layer 1 and previously had layers 0/1/2, the old layer 2 becomes the new layer 1.',
  ],
};
