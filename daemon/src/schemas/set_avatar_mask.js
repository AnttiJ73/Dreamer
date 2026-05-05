'use strict';

module.exports = {
  kind: 'set_avatar_mask',
  summary: "Update an existing AvatarMask. CLI verb: `set-avatar-mask`. Same shape as create-avatar-mask but operates on an existing asset.",
  requirements: null,
  args: {
    assetPath: { type: 'string', cli: '--asset' },
    guid:      { type: 'string', cli: '--asset (GUID form)' },
    humanoid:   { type: 'object', cli: '--humanoid', description: 'JSON dict of body parts. Only listed keys change.' },
    transforms: { type: 'array',  cli: '--transforms', description: 'JSON array. REPLACES the entire transform list.' },
  },
  constraints: [{ rule: 'atLeastOne', fields: ['assetPath', 'guid'] }],
  result: {
    type: 'object',
    fields: {
      set: { type: 'boolean' },
      assetPath: { type: 'string' },
      transformCount: { type: 'integer' },
    },
  },
  examples: [
    {
      title: 'Disable head animation in an existing mask',
      cli: './bin/dreamer set-avatar-mask --asset Assets/Animators/UpperBodyMask.mask --humanoid \'{"Head":false}\' --wait',
      args: { assetPath: 'Assets/Animators/UpperBodyMask.mask', humanoid: { Head: false } },
    },
  ],
  pitfalls: [
    'Humanoid is partial-update (only listed keys change); Transforms is total-replace. Inspect first if you want to merge.',
  ],
};
