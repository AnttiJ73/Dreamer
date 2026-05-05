'use strict';

module.exports = {
  kind: 'set_animator_layer',
  summary:
    "Update fields on an existing AnimatorController layer (rename, reweight, change blending mode, swap mask). " +
    "CLI verb: `set-animator-layer`. Only fields you pass change.",
  requirements: null,
  args: {
    assetPath: { type: 'string', cli: '--asset' },
    guid:      { type: 'string', cli: '--asset (GUID form)' },
    layer:     { type: 'integer', cli: '--layer', description: 'Index of layer to modify.' },
    name:      { type: 'string', cli: '--name', description: 'New layer name.' },
    weight:    { type: 'number', cli: '--weight' },
    blending:  { type: 'string', cli: '--blending', enum: ['Override', 'Additive'] },
    mask:      { type: 'string', cli: '--mask', description: 'Path to AvatarMask. Pass empty string to clear.' },
    ikPass:    { type: 'boolean', cli: '--ik-pass' },
    syncedLayerIndex: { type: 'integer', cli: '--synced-layer', description: '-1 = no sync (default). Other index = sync states from that layer.' },
    syncedLayerAffectsTiming: { type: 'boolean', cli: '--sync-timing' },
  },
  constraints: [{ rule: 'atLeastOne', fields: ['assetPath', 'guid'] }],
  result: {
    type: 'object',
    fields: {
      set: { type: 'boolean' },
      assetPath: { type: 'string' },
      layerIndex: { type: 'integer' },
      changedFieldCount: { type: 'integer' },
      changedFields: { type: 'array' },
    },
  },
  examples: [
    {
      title: 'Re-weight upper-body layer to 0.5',
      cli: './bin/dreamer set-animator-layer --asset Assets/Animators/PlayerCtl.controller --layer 1 --weight 0.5 --wait',
      args: { assetPath: 'Assets/Animators/PlayerCtl.controller', layer: 1, weight: 0.5 },
    },
  ],
  pitfalls: [
    'Layer 0 traditionally uses weight 1.0 and Override blending. Lowering weight on layer 0 partially blends OUT the controller\'s output, which is rarely intended.',
  ],
};
