'use strict';

module.exports = {
  kind: 'add_animator_parameter',
  summary:
    "Add a parameter (Bool / Int / Float / Trigger) to an AnimatorController. CLI verb: " +
    "`add-animator-parameter`. Parameters are referenced by name in transition conditions; " +
    "names must be unique within the controller.",
  requirements: null,
  args: {
    assetPath: { type: 'string', cli: '--asset' },
    guid: { type: 'string', cli: '--asset (GUID form)' },
    name: { type: 'string', cli: '--name', description: 'Parameter name. Used as identifier in conditions.' },
    type: { type: 'string', cli: '--type', enum: ['bool', 'int', 'float', 'trigger'], description: 'Parameter type. Default `bool`.' },
    default: { type: 'any', cli: '--default', description: 'Default value (matches the type). Booleans accept true/false; trigger accepts true to default-set.' },
  },
  constraints: [
    { rule: 'atLeastOne', fields: ['assetPath', 'guid'] },
  ],
  result: {
    type: 'object',
    fields: {
      added: { type: 'boolean' },
      assetPath: { type: 'string' },
      name: { type: 'string' },
      type: { type: 'string' },
      parameterCount: { type: 'integer' },
    },
  },
  examples: [
    {
      title: 'Bool parameter with default false',
      cli: './bin/dreamer add-animator-parameter --asset Assets/Animators/PlayerCtl.controller --name isMoving --type bool --default false --wait',
      args: { assetPath: 'Assets/Animators/PlayerCtl.controller', name: 'isMoving', type: 'bool', default: false },
    },
    {
      title: 'Float parameter (e.g. movement speed for blend logic)',
      cli: './bin/dreamer add-animator-parameter --asset Assets/Animators/PlayerCtl.controller --name speed --type float --wait',
      args: { assetPath: 'Assets/Animators/PlayerCtl.controller', name: 'speed', type: 'float' },
    },
    {
      title: 'Trigger (one-shot)',
      cli: './bin/dreamer add-animator-parameter --asset Assets/Animators/PlayerCtl.controller --name attack --type trigger --wait',
      args: { assetPath: 'Assets/Animators/PlayerCtl.controller', name: 'attack', type: 'trigger' },
    },
  ],
  pitfalls: [
    'Parameter names are case-sensitive and must be UNIQUE within the controller. Adding a duplicate name is rejected.',
    'Triggers fire once and reset to false. Use `Animator.SetTrigger("name")` from gameplay code; conditions on triggers use mode "If".',
    'Conditions reference parameter names. Add parameters BEFORE adding transitions that condition on them — otherwise the condition is silently dropped at runtime.',
  ],
};
