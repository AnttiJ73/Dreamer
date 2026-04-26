'use strict';

module.exports = {
  kind: 'delete_animation_curve',
  summary:
    "Remove one float-curve binding from an AnimationClip. CLI verb: `delete-animation-curve`. " +
    "Identifies the binding by (target, componentType, propertyName) — same triple used by " +
    "set-animation-curve and sample-animation-curve. Object-reference curves are not removable " +
    "via this command in v1.",
  requirements: null,
  args: {
    assetPath: { type: 'string', cli: '--asset' },
    guid: { type: 'string', cli: '--asset (GUID form)' },
    target: { type: 'string', cli: '--target', description: 'Relative path inside the animated hierarchy. Empty = root.' },
    componentType: { type: 'string', cli: '--component' },
    propertyName: { type: 'string', cli: '--property' },
  },
  constraints: [
    { rule: 'atLeastOne', fields: ['assetPath', 'guid'] },
    { rule: 'required', fields: ['componentType', 'propertyName'] },
  ],
  result: {
    type: 'object',
    fields: {
      deleted: { type: 'boolean' },
      assetPath: { type: 'string' },
      target: { type: 'string' },
      componentType: { type: 'string' },
      propertyName: { type: 'string' },
    },
  },
  examples: [
    {
      title: 'Remove the Y-position curve from an idle clip',
      cli: './bin/dreamer delete-animation-curve --asset Assets/Animations/Idle.anim --target "" --component UnityEngine.Transform --property m_LocalPosition.y --wait',
      args: { assetPath: 'Assets/Animations/Idle.anim', target: '', componentType: 'UnityEngine.Transform', propertyName: 'm_LocalPosition.y' },
    },
  ],
  pitfalls: [
    'The triple must match exactly. Run `inspect-animation-clip` to see existing bindings if you\'re not sure.',
  ],
};
