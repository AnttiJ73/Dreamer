'use strict';

module.exports = {
  kind: 'add_animator_state',
  summary:
    "Add a state to an AnimatorController layer. CLI verb: `add-animator-state`. " +
    "States hold a Motion (typically an AnimationClip), a playback speed, and outgoing " +
    "transitions. The first state added to an empty layer becomes the default.",
  requirements: null,
  args: {
    assetPath: { type: 'string', cli: '--asset' },
    guid: { type: 'string', cli: '--asset (GUID form)' },
    layer: { type: 'integer', cli: '--layer', description: 'Layer index. Default 0 (the base layer).' },
    name: { type: 'string', cli: '--name', description: 'State name. Must be unique within the layer.' },
    motion: { type: 'string', cli: '--motion', description: 'Path to an AnimationClip (.anim) to bind as this state\'s Motion. Optional — leave unset for an empty state.' },
    speed: { type: 'number', cli: '--speed', description: 'Playback speed multiplier. Default 1.0.' },
  },
  constraints: [
    { rule: 'atLeastOne', fields: ['assetPath', 'guid'] },
  ],
  result: {
    type: 'object',
    fields: {
      added: { type: 'boolean' },
      assetPath: { type: 'string' },
      layer: { type: 'integer' },
      name: { type: 'string' },
      motion: { type: 'string' },
      speed: { type: 'number' },
      isDefault: { type: 'boolean', description: 'True if this state was set as the layer\'s default (auto for first state on empty layer).' },
    },
  },
  examples: [
    {
      title: 'Idle state with bound clip',
      cli: './bin/dreamer add-animator-state --asset Assets/Animators/PlayerCtl.controller --name Idle --motion Assets/Animations/Idle.anim --wait',
      args: { assetPath: 'Assets/Animators/PlayerCtl.controller', name: 'Idle', motion: 'Assets/Animations/Idle.anim' },
    },
    {
      title: 'Walk state at half speed',
      cli: './bin/dreamer add-animator-state --asset Assets/Animators/PlayerCtl.controller --name Walk --motion Assets/Animations/Walk.anim --speed 0.5 --wait',
      args: { assetPath: 'Assets/Animators/PlayerCtl.controller', name: 'Walk', motion: 'Assets/Animations/Walk.anim', speed: 0.5 },
    },
    {
      title: 'Empty state (motion to be wired later)',
      cli: './bin/dreamer add-animator-state --asset Assets/Animators/PlayerCtl.controller --name Attack --wait',
      args: { assetPath: 'Assets/Animators/PlayerCtl.controller', name: 'Attack' },
    },
  ],
  pitfalls: [
    'State names are case-sensitive and must be unique per layer. Used as identifiers in `add-animator-transition --from`/`--to` and `set-animator-default-state --state`.',
    'The first state added to an empty layer auto-becomes the default state. Override later via `set-animator-default-state`.',
    'Motion: pass an AnimationClip path directly. To use a Blend Tree, author it in the Unity Animator window — not supported via CLI in v1.',
  ],
};
