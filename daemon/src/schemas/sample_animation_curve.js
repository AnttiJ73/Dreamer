'use strict';

module.exports = {
  kind: 'sample_animation_curve',
  summary:
    "Evaluate one float curve in an AnimationClip at N evenly-spaced times and return " +
    "the (t, v) table. CLI verb: `sample-animation-curve`. The right tool to verify a " +
    "curve numerically — read back the table and check the agent's expectations against " +
    "actual evaluated values (catches tangent surprises, overshoot, wrong interp mode). " +
    "Default samples=30; range defaults to the curve's full span.",
  requirements: null,
  args: {
    assetPath: { type: 'string', cli: '--asset', description: 'Path to the .anim asset.' },
    guid: { type: 'string', cli: '--asset (GUID form)', description: 'AnimationClip GUID.' },
    target: { type: 'string', cli: '--target', description: 'Path inside the animated hierarchy. Empty = root. Same as set-animation-curve.' },
    componentType: { type: 'string', cli: '--component', description: 'Component type FQN.' },
    propertyName: { type: 'string', cli: '--property', description: 'SerializedProperty path (e.g. `m_LocalPosition.y`).' },
    samples: {
      type: 'integer',
      cli: '--samples',
      description: 'Number of samples in the response (default 30, clamped 2..1000). 30 is enough for the agent to spot wrong shapes; bump to 100+ for fine inspection.',
    },
    tStart: { type: 'number', cli: '--t-start', description: 'Sample range start. Default = first keyframe time.' },
    tEnd:   { type: 'number', cli: '--t-end',   description: 'Sample range end. Default = last keyframe time.' },
  },
  constraints: [
    { rule: 'atLeastOne', fields: ['assetPath', 'guid'] },
    { rule: 'required', fields: ['componentType', 'propertyName'] },
  ],
  result: {
    type: 'object',
    fields: {
      assetPath: { type: 'string' },
      binding: { type: 'object', description: '{ target, componentType, propertyName }' },
      sampleCount: { type: 'integer' },
      tStart: { type: 'number' },
      tEnd:   { type: 'number' },
      valueMin: { type: 'number', description: 'Min sampled value over the requested range.' },
      valueMax: { type: 'number', description: 'Max sampled value over the requested range.' },
      samples: { type: 'array', description: 'Array of `{ t, v }` rows, t in seconds. Both values rounded to 4 decimals for compactness.' },
      curveSummary: { type: 'object', description: 'Stats over the entire curve (not just the requested range): keyCount, timeMin, timeMax, duration, valueMin, valueMax.' },
    },
  },
  examples: [
    {
      title: 'Verify the bob curve evaluates symmetrically',
      cli: './bin/dreamer sample-animation-curve --asset Assets/Animations/Idle.anim --target "" --component UnityEngine.Transform --property m_LocalPosition.y --samples 11 --wait',
      args: { assetPath: 'Assets/Animations/Idle.anim', target: '', componentType: 'UnityEngine.Transform', propertyName: 'm_LocalPosition.y', samples: 11 },
    },
    {
      title: 'Sample only the first half-second',
      cli: './bin/dreamer sample-animation-curve --asset X.anim --target "" --component UnityEngine.Transform --property m_LocalPosition.y --t-start 0 --t-end 0.5 --samples 20 --wait',
      args: { assetPath: 'X.anim', target: '', componentType: 'UnityEngine.Transform', propertyName: 'm_LocalPosition.y', tStart: 0, tEnd: 0.5, samples: 20 },
    },
  ],
  pitfalls: [
    'This is the agent\'s primary tool for VERIFYING that a curve does what you intended. After every `set-animation-curve`, sample the same binding back and compare to expectations — tangent modes (especially "auto") can produce surprising overshoot.',
    'Sample count is independent of the clip\'s frameRate — sampling at 30 doesn\'t mean every Unity frame, it means 30 evenly-spaced points in [tStart, tEnd]. To inspect frame-by-frame, set `samples = (tEnd - tStart) * frameRate + 1`.',
    'A binding that doesn\'t exist returns "No curve found" — run `inspect-animation-clip` first to discover the exact binding triples.',
  ],
};
