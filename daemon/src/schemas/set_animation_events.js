'use strict';

module.exports = {
  kind: 'set_animation_events',
  summary:
    "Replace ALL animation events on a clip with a new array. CLI verb: `set-animation-events`. " +
    "Each event fires `functionName(...)` on a MonoBehaviour bound to the Animator at the given time. " +
    "Pass `--events []` to clear all events. To inspect existing events, use `inspect-animation-clip`.",
  requirements: null,
  args: {
    assetPath: { type: 'string', cli: '--asset', description: 'Path to the .anim asset.' },
    guid: { type: 'string', cli: '--asset (GUID form)', description: 'AnimationClip GUID.' },
    events: {
      type: 'array',
      cli: '--events',
      description:
        'JSON array. Each event: `{ "time": <seconds>, "functionName": "OnFootstep", ' +
        '"floatParameter"?: 1.5, "intParameter"?: 0, "stringParameter"?: "left", ' +
        '"objectReferenceParameter"?: { "assetRef": "...", "subAsset"?: "..." } }`. ' +
        'The receiving MonoBehaviour\'s method signature must match: zero params, OR exactly one ' +
        'parameter of type float / int / string / Object / AnimationEvent. ' +
        'Pass `[]` to clear all events.',
    },
  },
  constraints: [
    { rule: 'atLeastOne', fields: ['assetPath', 'guid'] },
  ],
  result: {
    type: 'object',
    fields: {
      set: { type: 'boolean' },
      assetPath: { type: 'string' },
      eventCount: { type: 'integer' },
    },
  },
  examples: [
    {
      title: 'Two footstep events at 0.25s and 0.75s',
      cli: './bin/dreamer set-animation-events --asset Assets/Animations/Walk.anim --events \'[{"time":0.25,"functionName":"OnFootstep","stringParameter":"left"},{"time":0.75,"functionName":"OnFootstep","stringParameter":"right"}]\' --wait',
      args: { assetPath: 'Assets/Animations/Walk.anim', events: [] },
    },
    {
      title: 'Spawn-effect event with a sprite-atlas reference parameter',
      cli: './bin/dreamer set-animation-events --asset Assets/Animations/Attack.anim --events \'[{"time":0.4,"functionName":"SpawnEffect","objectReferenceParameter":{"assetRef":"Assets/PFX/Slash.prefab"}}]\' --wait',
      args: { assetPath: 'Assets/Animations/Attack.anim', events: [] },
    },
    {
      title: 'Clear all events',
      cli: './bin/dreamer set-animation-events --asset Assets/Animations/Walk.anim --events \'[]\' --wait',
      args: { assetPath: 'Assets/Animations/Walk.anim', events: [] },
    },
  ],
  pitfalls: [
    'This REPLACES all events. To add one, first inspect-animation-clip to read existing events, then re-submit the full list (existing + new).',
    'Events fire on a MonoBehaviour attached to the GameObject hosting the Animator. Method names are case-sensitive and must match exactly.',
    'Method signature: must be zero params OR exactly one float/int/string/Object/AnimationEvent param. Multiple params are not supported by Unity\'s AnimationEvent system.',
    'objectReferenceParameter must be a Unity asset (prefab, sprite, scriptable object). Scene references aren\'t supported — events store the asset by reference.',
  ],
};
