'use strict';

module.exports = {
  kind: 'create_animator_controller',
  summary:
    "Create a new AnimatorController asset (.controller) with one default layer and the standard " +
    "Entry / Exit / AnyState nodes auto-created. CLI verb: `create-animator-controller`. " +
    "Add parameters with `add-animator-parameter`, states with `add-animator-state`, transitions with " +
    "`add-animator-transition`. Provided by the `com.dreamer.agent-bridge.animation` add-on.",
  requirements: null,
  args: {
    name: { type: 'string', cli: '--name', description: 'Controller filename (without .controller).' },
    path: { type: 'string', cli: '--path', description: 'Asset folder under Assets/ (default Assets/Animations).' },
  },
  constraints: [
    { rule: 'atLeastOne', fields: ['name'] },
  ],
  result: {
    type: 'object',
    fields: {
      created: { type: 'boolean' },
      assetPath: { type: 'string' },
      name: { type: 'string' },
      layerCount: { type: 'integer' },
    },
  },
  examples: [
    {
      title: 'Create a player AnimatorController',
      cli: './bin/dreamer create-animator-controller --name PlayerCtl --path Assets/Animators --wait',
      args: { name: 'PlayerCtl', path: 'Assets/Animators' },
    },
  ],
  pitfalls: [
    'After creating, attach the controller to a scene/prefab Animator via `set-property --component UnityEngine.Animator --property m_Controller --value \'{"assetRef":"<path>.controller"}\'`.',
    'States, transitions, and parameters are added in separate calls. Order: parameters → states → transitions (transitions can reference parameters via conditions).',
  ],
};
