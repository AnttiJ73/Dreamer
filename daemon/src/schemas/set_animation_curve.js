'use strict';

module.exports = {
  kind: 'set_animation_curve',
  summary:
    "Write or replace one float-curve binding on an AnimationClip. CLI verb: `set-animation-curve`. " +
    "Each binding is identified by (target, componentType, propertyName); writing the same triple " +
    "again replaces the curve. Use `inspect-animation-clip` to discover existing bindings, then " +
    "`sample-animation-curve` to verify the curve evaluates as expected.",
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
      description: 'AnimationClip GUID — alternative to assetPath.',
    },
    target: {
      type: 'string',
      cli: '--target',
      description: 'Path INSIDE the animated GameObject hierarchy, relative to the GO that hosts the Animator/Animation. Empty / unset / "" = root GO. Examples: "" (root), "Visuals" (direct child), "Visuals/Body" (nested). NOT a scene path.',
    },
    componentType: {
      type: 'string',
      cli: '--component',
      description: 'Component type FQN — e.g. `UnityEngine.Transform`, `UnityEngine.SpriteRenderer`. The animated component class.',
    },
    propertyName: {
      type: 'string',
      cli: '--property',
      description: 'SerializedProperty path on the component. Examples: `m_LocalPosition.y`, `localEulerAngles.z`, `m_LocalScale.x`, `m_Color.r`. Use the `m_`-prefixed names — the Animation system stores them in serialized form.',
    },
    keys: {
      type: 'array',
      cli: '--keys',
      description: 'JSON array of keyframe objects. Each: `{ "t": time, "v": value, "interp"?: "linear"|"constant"|"auto"|"clamped"|"free", "inTangent"?: number, "outTangent"?: number, "inWeight"?: number, "outWeight"?: number }`. `interp` defaults to "linear". For "free" mode, supply explicit `inTangent`/`outTangent`. At minimum: `[{"t":0,"v":0},{"t":1,"v":1}]`.',
    },
  },
  constraints: [
    { rule: 'atLeastOne', fields: ['assetPath', 'guid'] },
    { rule: 'required', fields: ['componentType', 'propertyName', 'keys'] },
  ],
  result: {
    type: 'object',
    fields: {
      set: { type: 'boolean' },
      assetPath: { type: 'string' },
      target: { type: 'string' },
      componentType: { type: 'string' },
      propertyName: { type: 'string' },
      keyCount: { type: 'integer' },
      summary: {
        type: 'object',
        description: 'Stats on the resulting curve: keyCount, timeMin, timeMax, duration, valueMin, valueMax (probed across the curve, so includes overshoot from tangents).',
      },
    },
  },
  examples: [
    {
      title: 'Bob the Player up and down (Y position, 1s loop)',
      cli: './bin/dreamer set-animation-curve --asset Assets/Animations/Idle.anim --target "" --component UnityEngine.Transform --property m_LocalPosition.y --keys \'[{"t":0,"v":0,"interp":"linear"},{"t":0.5,"v":0.2,"interp":"linear"},{"t":1,"v":0,"interp":"linear"}]\' --wait',
      args: { assetPath: 'Assets/Animations/Idle.anim', target: '', componentType: 'UnityEngine.Transform', propertyName: 'm_LocalPosition.y', keys: [{ t: 0, v: 0, interp: 'linear' }, { t: 0.5, v: 0.2, interp: 'linear' }, { t: 1, v: 0, interp: 'linear' }] },
    },
    {
      title: 'Animate child sprite color alpha (fade in)',
      cli: './bin/dreamer set-animation-curve --asset Assets/Animations/FadeIn.anim --target Visuals/Body --component UnityEngine.SpriteRenderer --property m_Color.a --keys \'[{"t":0,"v":0,"interp":"auto"},{"t":0.5,"v":1,"interp":"auto"}]\' --wait',
      args: { assetPath: 'Assets/Animations/FadeIn.anim', target: 'Visuals/Body', componentType: 'UnityEngine.SpriteRenderer', propertyName: 'm_Color.a', keys: [{ t: 0, v: 0, interp: 'auto' }, { t: 0.5, v: 1, interp: 'auto' }] },
    },
    {
      title: 'Step function (constant interp — no easing)',
      cli: './bin/dreamer set-animation-curve --asset Assets/Animations/Blink.anim --target "" --component UnityEngine.Transform --property m_LocalScale.x --keys \'[{"t":0,"v":1,"interp":"constant"},{"t":0.1,"v":0.5,"interp":"constant"},{"t":0.2,"v":1,"interp":"constant"}]\' --wait',
      args: { assetPath: 'Assets/Animations/Blink.anim', target: '', componentType: 'UnityEngine.Transform', propertyName: 'm_LocalScale.x', keys: [{ t: 0, v: 1, interp: 'constant' }, { t: 0.1, v: 0.5, interp: 'constant' }, { t: 0.2, v: 1, interp: 'constant' }] },
    },
    {
      title: 'Explicit tangents (free mode — full control)',
      cli: './bin/dreamer set-animation-curve --asset X.anim --target "" --component UnityEngine.Transform --property m_LocalPosition.x --keys \'[{"t":0,"v":0,"interp":"free","outTangent":2},{"t":1,"v":1,"interp":"free","inTangent":2}]\' --wait',
      args: {},
    },
  ],
  pitfalls: [
    'Property names use the SERIALIZED form (`m_LocalPosition.y`, `m_Color.r`) — same convention as set-property on built-in Unity components. NOT `localPosition.y` or `color.r`.',
    'Quaternion rotations animate via `localEulerAngles.x/y/z` (Euler — what the Animation window shows) NOT `m_LocalRotation.x/y/z/w` (the underlying quaternion). The latter rarely produces what you want.',
    '`target` is RELATIVE to the animated GameObject, NOT a scene path. Empty string = root. No leading slash. The Animation system resolves the path against the GO that hosts the Animator/Animation component at playback time.',
    'After writing, run `sample-animation-curve` with the same triple to read the curve back numerically — that\'s the easiest way to verify your tangents are doing what you intended.',
    'Replacing a binding: call this command again with the same (target, componentType, propertyName) and a new `keys` array. The old curve is discarded.',
    'Object-reference curves (sprite swaps via `m_Sprite`, GO active toggles via `m_IsActive`) use a separate Unity API and are NOT supported by this command in v1. Use the Animation window or wait for v2.',
  ],
};
