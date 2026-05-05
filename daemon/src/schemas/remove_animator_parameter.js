'use strict';

module.exports = {
  kind: 'remove_animator_parameter',
  summary:
    "Remove a parameter from an AnimatorController. CLI verb: `remove-animator-parameter`. " +
    "Refuses by default if any transition condition references the parameter; pass `--force` to remove anyway " +
    "(orphaned conditions stay in the controller but Unity won't evaluate them — silent no-op at runtime).",
  requirements: null,
  args: {
    assetPath: { type: 'string', cli: '--asset' },
    guid:      { type: 'string', cli: '--asset (GUID form)' },
    name:      { type: 'string', cli: '--name', description: 'Parameter name to remove.' },
    force:     { type: 'boolean', cli: '--force', description: 'Remove even if transitions reference this parameter. Default false.' },
  },
  constraints: [{ rule: 'atLeastOne', fields: ['assetPath', 'guid'] }],
  result: {
    type: 'object',
    fields: {
      removed: { type: 'boolean' },
      assetPath: { type: 'string' },
      name: { type: 'string' },
      parameterCount: { type: 'integer' },
      orphanedConditions: { type: 'integer', description: 'Count of transition conditions still referencing the now-removed parameter (when --force was used).' },
    },
  },
  examples: [
    {
      title: 'Remove an unused parameter',
      cli: './bin/dreamer remove-animator-parameter --asset Assets/Animators/PlayerCtl.controller --name speed --wait',
      args: { assetPath: 'Assets/Animators/PlayerCtl.controller', name: 'speed' },
    },
  ],
  pitfalls: [
    'Removing a parameter referenced by transition conditions silently disables those conditions at runtime. Without --force the command refuses; with --force it proceeds and reports `orphanedConditions`. Inspect the controller after to confirm transitions still fire as intended.',
  ],
};
