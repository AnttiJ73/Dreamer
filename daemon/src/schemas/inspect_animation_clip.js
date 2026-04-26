'use strict';

module.exports = {
  kind: 'inspect_animation_clip',
  summary:
    "Read an AnimationClip's metadata and curve bindings. CLI verb: `inspect-animation-clip`. " +
    "Returns clip name, length, frameRate, loop flag, and an array of every binding " +
    "(target/component/property + per-curve summary: keyCount, time/value range). " +
    "Object-reference curves are listed but their content isn't editable in v1.",
  requirements: null,
  args: {
    assetPath: {
      type: 'string',
      cli: '--asset',
      description: 'Path to the .anim asset.',
    },
    guid: {
      type: 'string',
      cli: '--asset (GUID form)',
      description: 'AnimationClip GUID.',
    },
  },
  constraints: [
    { rule: 'atLeastOne', fields: ['assetPath', 'guid'] },
  ],
  result: {
    type: 'object',
    fields: {
      assetPath: { type: 'string' },
      name: { type: 'string' },
      length: { type: 'number', description: 'Derived from the longest curve\'s end-time.' },
      frameRate: { type: 'number' },
      loop: { type: 'boolean' },
      bindingCount: { type: 'integer' },
      bindings: { type: 'array', description: 'Each: { target, componentType, propertyName, keyCount, summary{ keyCount, timeMin, timeMax, duration, valueMin, valueMax } }.' },
      objectReferenceBindingCount: { type: 'integer' },
      objectReferenceBindings: { type: 'array', description: 'Per-binding metadata only — content (sprite swaps etc.) not exposed in v1.' },
    },
  },
  examples: [
    {
      title: 'Inspect an idle clip',
      cli: './bin/dreamer inspect-animation-clip --asset Assets/Animations/Idle.anim --wait',
      args: { assetPath: 'Assets/Animations/Idle.anim' },
    },
  ],
  pitfalls: [
    'Always run this before `set-animation-curve` if you\'re modifying an existing clip — the binding triple (target, componentType, propertyName) must match exactly to replace a curve, otherwise you create a duplicate binding.',
    'A clip with `length=0` and `bindingCount=0` is empty (just the asset shell). Add curves with `set-animation-curve`.',
  ],
};
