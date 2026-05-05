'use strict';

module.exports = {
  kind: 'set_project_setting',
  summary:
    "Generic SerializedObject editor for any `ProjectSettings/*.asset` file. CLI verb: `set-project-setting`. " +
    "This is the catch-all when no first-class command exists. Mirror of `set-property`'s value semantics " +
    "(arrays, sparse `{_size, N: val}`, asset/scene refs) but targets the singleton settings object instead of a Component. " +
    "Run `inspect-project-settings` to discover available files, then `inspect-project-setting --file X` to discover property paths.",
  requirements: null,
  args: {
    file: {
      type: 'string',
      required: true,
      cli: '--file',
      description: 'Short name (`TagManager`), filename (`TagManager.asset`), or full path (`ProjectSettings/TagManager.asset`).',
    },
    propertyPath: {
      type: 'string',
      required: true,
      cli: '--property',
      description:
        'Serialized property path. Examples: `m_Gravity` (DynamicsManager), `layers.Array.data[8]` (TagManager), ' +
        '`bundleVersion` or `iPhoneBundleIdentifier` (ProjectSettings.asset / PlayerSettings). Bracket shorthand `field[N]` ' +
        'is rewritten to `field.Array.data[N]`.',
    },
    value: {
      type: 'any',
      required: true,
      cli: '--value',
      description:
        'JSON value. Numbers, strings, bools, arrays, and nested objects. For object refs use `{"assetRef":"path/X.asset"}`. ' +
        'For struct fields pass an object with the struct\'s sub-fields. Arrays: pass `[]` to clear; pass `{"_size":N,"K":val}` for sparse.',
    },
  },
  result: {
    type: 'object',
    fields: {
      file: { type: 'string' },
      propertyPath: { type: 'string', description: 'The resolved property path (after bracket-rewrite).' },
      typeName: { type: 'string', description: 'Full Unity type of the settings singleton (e.g. UnityEngine.Physics, UnityEditor.PlayerSettings).' },
      set: { type: 'boolean' },
    },
  },
  examples: [
    {
      title: 'Bump 3D solver iterations to 8',
      cli: "./bin/dreamer set-project-setting --file DynamicsManager --property m_DefaultSolverIterations --value 8 --wait",
      args: { file: 'DynamicsManager', propertyPath: 'm_DefaultSolverIterations', value: 8 },
    },
    {
      title: 'Set max simulation step (TimeManager)',
      cli: "./bin/dreamer set-project-setting --file TimeManager --property Maximum\\\\ Allowed\\\\ Timestep --value 0.05 --wait",
      args: { file: 'TimeManager', propertyPath: 'Maximum Allowed Timestep', value: 0.05 },
    },
    {
      title: 'Rename layer 8 (also doable via set-layer-name)',
      cli: "./bin/dreamer set-project-setting --file TagManager --property 'layers[8]' --value Walkable --wait",
      args: { file: 'TagManager', propertyPath: 'layers[8]', value: 'Walkable' },
    },
  ],
  pitfalls: [
    'Property paths use Unity\'s SerializedProperty conventions, NOT the C# field names. `Physics.gravity` is `m_Gravity`, `Physics2D.gravity` is `m_Gravity` too (different file). Always check via inspect-project-setting first.',
    'Some settings (PlayerSettings build target overrides, GraphicsSettings shader stripping) don\'t round-trip via SerializedObject and need first-class APIs — file an issue if you hit one.',
    'Changes are persisted via AssetDatabase.SaveAssets(); a domain-reload-incompatible setting may not take effect until the next reload.',
  ],
};
