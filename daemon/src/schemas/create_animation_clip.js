'use strict';

module.exports = {
  kind: 'create_animation_clip',
  summary:
    "Create a new AnimationClip asset (.anim). CLI verb: `create-animation-clip`. " +
    "Sets frameRate (default 30) and the loopTime setting. Length is derived from " +
    "curves once added — a freshly-created clip has length=0 until you add curves. " +
    "Provided by the `com.dreamer.agent-bridge.animation` add-on.",
  requirements: null,
  args: {
    name: {
      type: 'string',
      cli: '--name',
      description: 'Clip filename (without `.anim` extension).',
    },
    path: {
      type: 'string',
      cli: '--path',
      description: 'Asset folder under Assets/ (default `Assets/Animations`). Created if it doesn\'t exist.',
    },
    frameRate: {
      type: 'number',
      cli: '--frame-rate',
      description: 'Sample rate for the clip in fps (default 30). Affects how the timeline displays in the Animation window; doesn\'t change the curves themselves.',
    },
    loop: {
      type: 'boolean',
      cli: '--loop',
      description: 'Set the AnimationClipSettings.loopTime flag so the clip plays back as a loop. Default false.',
    },
  },
  constraints: [
    { rule: 'required', fields: ['name'] },
  ],
  result: {
    type: 'object',
    fields: {
      created: { type: 'boolean' },
      assetPath: { type: 'string' },
      name: { type: 'string' },
      frameRate: { type: 'number' },
      loop: { type: 'boolean' },
    },
  },
  examples: [
    {
      title: 'Create an empty 30fps idle clip',
      cli: './bin/dreamer create-animation-clip --name Idle --loop true --wait',
      args: { name: 'Idle', loop: true },
    },
    {
      title: 'Create a 60fps clip in a custom folder',
      cli: './bin/dreamer create-animation-clip --name Attack --path Assets/Anims/Combat --frame-rate 60 --wait',
      args: { name: 'Attack', path: 'Assets/Anims/Combat', frameRate: 60 },
    },
  ],
  pitfalls: [
    'Length is read-only on AnimationClip — it follows the longest curve. A freshly-created clip has length=0; add curves with `set-animation-curve` to give it a duration.',
    'For looping behavior, set `--loop true` here. To toggle later, use `set-property` on the clip\'s AnimationClipSettings — but it\'s simpler to set at create-time.',
    'Add-on dependency: this command is only available when `com.dreamer.agent-bridge.animation` is installed. If absent, the dispatcher returns "Unknown command kind".',
  ],
};
