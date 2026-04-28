'use strict';

module.exports = {
  kind: 'inspect_avatar_mask',
  summary: "Read an AvatarMask's humanoid body parts + transform list. CLI verb: `inspect-avatar-mask`.",
  requirements: null,
  args: {
    assetPath: { type: 'string', cli: '--asset' },
    guid:      { type: 'string', cli: '--asset (GUID form)' },
  },
  constraints: [{ rule: 'atLeastOne', fields: ['assetPath', 'guid'] }],
  result: {
    type: 'object',
    fields: {
      assetPath: { type: 'string' },
      name: { type: 'string' },
      humanoid: { type: 'object', description: 'Each humanoid body part → bool (active).' },
      transformCount: { type: 'integer' },
      transforms: { type: 'array', description: 'Each: { path, active }.' },
    },
  },
  examples: [
    {
      title: 'Inspect a mask',
      cli: './bin/dreamer inspect-avatar-mask --asset Assets/Animators/UpperBodyMask.mask --wait',
      args: { assetPath: 'Assets/Animators/UpperBodyMask.mask' },
    },
  ],
};
