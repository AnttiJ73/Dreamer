'use strict';

module.exports = {
  kind: 'add_animator_layer',
  summary:
    "Add a layer to an AnimatorController. CLI verb: `add-animator-layer`. " +
    "Layers play simultaneously and combine via blendingMode. Common pattern: layer 0 = full body movement, layer 1 = upper body action with an avatar mask + Override blending.",
  requirements: null,
  args: {
    assetPath: { type: 'string', cli: '--asset' },
    guid:      { type: 'string', cli: '--asset (GUID form)' },
    name:      { type: 'string', cli: '--name', description: 'Layer name. Must be unique within the controller.' },
    weight:    { type: 'number', cli: '--weight', description: 'Default weight 0..1. Default 1.0.' },
    blending:  { type: 'string', cli: '--blending', enum: ['Override', 'Additive'], description: 'How this layer combines with lower layers. Default Override.' },
    mask:      { type: 'string', cli: '--mask', description: 'Path to an AvatarMask asset. Restricts this layer to specific bones / humanoid parts.' },
    ikPass:    { type: 'boolean', cli: '--ik-pass', description: 'Run an IK pass after this layer. Default false.' },
  },
  constraints: [{ rule: 'atLeastOne', fields: ['assetPath', 'guid'] }],
  result: {
    type: 'object',
    fields: {
      added: { type: 'boolean' },
      assetPath: { type: 'string' },
      layerIndex: { type: 'integer' },
      name: { type: 'string' },
      weight: { type: 'number' },
      blending: { type: 'string' },
      hasMask: { type: 'boolean' },
    },
  },
  examples: [
    {
      title: 'Upper-body layer with avatar mask',
      cli: './bin/dreamer add-animator-layer --asset Assets/Animators/PlayerCtl.controller --name UpperBody --weight 1.0 --blending Override --mask Assets/Animators/UpperBodyMask.mask --wait',
      args: { assetPath: 'Assets/Animators/PlayerCtl.controller', name: 'UpperBody', weight: 1.0, blending: 'Override', mask: 'Assets/Animators/UpperBodyMask.mask' },
    },
    {
      title: 'Additive overlay layer (e.g. breathing)',
      cli: './bin/dreamer add-animator-layer --asset Assets/Animators/PlayerCtl.controller --name Breathing --weight 0.3 --blending Additive --wait',
      args: { assetPath: 'Assets/Animators/PlayerCtl.controller', name: 'Breathing', weight: 0.3, blending: 'Additive' },
    },
  ],
  pitfalls: [
    'New layers start with empty state machines. Add states/transitions on the new layer via `add-animator-state --layer N` etc.',
    'Avatar masks must exist before assignment — create one via `create-avatar-mask`.',
  ],
};
