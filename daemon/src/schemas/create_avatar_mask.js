'use strict';

module.exports = {
  kind: 'create_avatar_mask',
  summary:
    "Create an AvatarMask asset. CLI verb: `create-avatar-mask`. " +
    "Masks restrict an animator layer to specific bones (Transform tab) or humanoid body parts (Humanoid tab). " +
    "Both can be set during creation via `--humanoid` and `--transforms` JSON.",
  requirements: null,
  args: {
    name: { type: 'string', cli: '--name', description: 'Asset filename (without .mask).' },
    path: { type: 'string', cli: '--path', description: 'Folder under Assets/. Default Assets/Animations.' },
    humanoid: {
      type: 'object',
      cli: '--humanoid',
      description:
        'JSON dict of humanoid body parts to enable/disable. Valid keys (any subset): ' +
        'Root, Body, Head, LeftLeg, RightLeg, LeftArm, RightArm, LeftFingers, RightFingers, ' +
        'LeftFootIK, RightFootIK, LeftHandIK, RightHandIK. Values: true|false.',
    },
    transforms: {
      type: 'array',
      cli: '--transforms',
      description: 'JSON array of `{path:"Hips/Spine/...", active:true}` per-bone toggles. Replaces the whole transform list.',
    },
  },
  constraints: [{ rule: 'atLeastOne', fields: ['name'] }],
  result: {
    type: 'object',
    fields: {
      created: { type: 'boolean' },
      assetPath: { type: 'string' },
      name: { type: 'string' },
      humanoidPartCount: { type: 'integer' },
      transformCount: { type: 'integer' },
    },
  },
  examples: [
    {
      title: 'Upper-body humanoid mask',
      cli: './bin/dreamer create-avatar-mask --name UpperBodyMask --path Assets/Animators --humanoid \'{"Body":true,"Head":true,"LeftArm":true,"RightArm":true,"LeftFingers":true,"RightFingers":true,"LeftLeg":false,"RightLeg":false}\' --wait',
      args: { name: 'UpperBodyMask', path: 'Assets/Animators', humanoid: { Body: true, Head: true, LeftArm: true, RightArm: true, LeftFingers: true, RightFingers: true, LeftLeg: false, RightLeg: false } },
    },
  ],
  pitfalls: [
    'Humanoid and Transform are independent — Humanoid mask works for humanoid avatars (rigs imported as Humanoid); Transform works on generic skeletons. Use whichever matches the target avatar type.',
  ],
};
