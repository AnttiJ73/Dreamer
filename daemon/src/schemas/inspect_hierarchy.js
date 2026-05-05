'use strict';

module.exports = {
  kind: 'inspect_hierarchy',
  summary: 'Dump a GameObject hierarchy — either an open SCENE (default) or a PREFAB asset (pass --asset). Recurses ALL children by default. CLI verb: `inspect-hierarchy`.',
  requirements: null,
  args: {
    scene: {
      type: 'string',
      cli: '--scene',
      description: 'Name of an open scene to inspect when multiple are loaded. Default: active scene. Ignored when --asset is given.',
    },
    assetPath: {
      type: 'string',
      cli: '--asset',
      description: 'Path to a .prefab — dump the prefab\'s hierarchy as if it were a single-rooted scene. Mutually exclusive with --scene.',
    },
    guid: {
      type: 'string',
      cli: '--asset (GUID form)',
      description: 'Asset GUID — alternative to --asset. The CLI auto-detects 32-hex strings as GUIDs.',
    },
    depth: {
      type: 'integer',
      cli: '--depth',
      description: 'Children recursion depth. -1 = unlimited (default), 0 = root level only, N = N levels.',
    },
    includeTransforms: {
      type: 'boolean',
      cli: '--include-transforms',
      description: 'When set, every node gets a `transform` object (localPosition, localEulerAngles, localScale).',
    },
    includeFields: {
      type: 'boolean',
      cli: '--include-fields',
      description: 'When set, every component gets a `fields` array with serialized field values. Heavier payload — opt in.',
    },
  },
  result: {
    type: 'object',
    fields: {
      source: { type: 'string', description: '"scene" or "prefab".' },
      scene: { type: 'string', description: 'Scene mode only.' },
      scenePath: { type: 'string', description: 'Scene mode only.' },
      assetPath: { type: 'string', description: 'Prefab mode only.' },
      guid: { type: 'string', description: 'Prefab mode only.' },
      rootObjectCount: { type: 'integer', description: 'Scene mode only.' },
      rootObjects: { type: 'array', description: 'Scene mode: array of node objects.' },
      root: { type: 'object', description: 'Prefab mode: single node object.' },
    },
  },
  examples: [
    {
      title: 'Inspect the active scene',
      cli: './bin/dreamer inspect-hierarchy --wait',
      args: {},
    },
    {
      title: 'Inspect a prefab\'s hierarchy (full tree)',
      cli: './bin/dreamer inspect-hierarchy --asset Assets/Prefabs/Boss.prefab --wait',
      args: { assetPath: 'Assets/Prefabs/Boss.prefab' },
    },
    {
      title: 'Scene + transforms (positions/scales per GO)',
      cli: './bin/dreamer inspect-hierarchy --include-transforms --wait',
      args: { includeTransforms: true },
    },
    {
      title: 'Scene + everything (transforms + field values)',
      cli: './bin/dreamer inspect-hierarchy --include-transforms --include-fields --wait',
      args: { includeTransforms: true, includeFields: true },
    },
    {
      title: 'Specific open scene',
      cli: './bin/dreamer inspect-hierarchy --scene UICanvas --wait',
      args: { scene: 'UICanvas' },
    },
  ],
  pitfalls: [
    'PREFAB MODE recurses through the prefab asset via AssetDatabase — read-only and fast. Variants/overrides resolve to their effective values.',
    '--include-fields is heavy: every component\'s every serialized field is iterated. Prefer `read-property` for single-value lookups.',
    'Component shape is `{type, fullType, enabled, fields?}` — same as `inspect`. Both commands now produce identical node shape.',
    'For comparing several prefabs, use `inspect-many --paths a,b,c` — one round-trip, results in stable order.',
  ],
};
