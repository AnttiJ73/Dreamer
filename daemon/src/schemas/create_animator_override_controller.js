'use strict';

module.exports = {
  kind: 'create_animator_override_controller',
  summary:
    "Create an AnimatorOverrideController. CLI verb: `create-animator-override-controller`. " +
    "Override controllers reuse a base AnimatorController's state machine but swap individual AnimationClips. " +
    "Use for variant characters / weapons / species sharing one logical state graph (states + transitions + parameters).",
  requirements: null,
  args: {
    name: { type: 'string', cli: '--name', description: 'Asset filename (without .overrideController).' },
    path: { type: 'string', cli: '--path', description: 'Folder under Assets/. Default Assets/Animations.' },
    base: { type: 'string', cli: '--base', description: 'Path to the base AnimatorController to override. Required.' },
  },
  constraints: [
    { rule: 'atLeastOne', fields: ['name'] },
    { rule: 'atLeastOne', fields: ['base'] },
  ],
  result: {
    type: 'object',
    fields: {
      created: { type: 'boolean' },
      assetPath: { type: 'string' },
      name: { type: 'string' },
      base: { type: 'string' },
      clipCount: { type: 'integer', description: 'Number of clips inherited from the base (each can be overridden).' },
    },
  },
  examples: [
    {
      title: 'Create a variant for an enemy archer reusing the base humanoid graph',
      cli: './bin/dreamer create-animator-override-controller --name EnemyArcher --base Assets/Animators/Humanoid.controller --path Assets/Animators --wait',
      args: { name: 'EnemyArcher', base: 'Assets/Animators/Humanoid.controller', path: 'Assets/Animators' },
    },
  ],
  pitfalls: [
    'After creation, all clips default to the base\'s clips (no overrides yet). Use `set-animator-override-clip` to swap specific ones.',
    'Override controllers wrap a base — they DO NOT copy it. Editing the base affects every override controller built on it.',
  ],
};
