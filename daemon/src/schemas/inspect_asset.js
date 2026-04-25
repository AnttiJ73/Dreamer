'use strict';

const { commonArgs } = require('./_common');

module.exports = {
  kind: 'inspect_asset',
  summary: 'Read an asset\'s structure: prefab GameObject hierarchy + components, ScriptableObject fields, scene metadata. Recurses ALL children by default. CLI verb: `inspect`.',
  requirements: null,
  args: {
    ...commonArgs.target(['asset', 'guid', 'scene-object']),
    depth: {
      type: 'integer',
      cli: '--depth',
      description: 'Children recursion depth. -1 = unlimited (default), 0 = root only (childCount but no children array), N = N levels deep. childCount is ALWAYS reported so callers can detect cap-reached.',
    },
    includeTransforms: {
      type: 'boolean',
      cli: '--include-transforms',
      description: 'When set, every node gets a `transform` object with localPosition, localEulerAngles, localScale. Use this for per-prefab transform comparisons.',
    },
    includeFields: {
      type: 'boolean',
      cli: '--include-fields',
      description: 'When set, every component gets a `fields` array with serialized field values (primitives, vectors, colors, object references). Heavier payload — opt in only when you need values.',
    },
  },
  constraints: [commonArgs.targetAtLeastOne(['asset', 'guid', 'scene-object'])],
  result: {
    type: 'object',
    fields: {
      path: { type: 'string', description: 'Asset path (asset target).' },
      guid: { type: 'string' },
      type: { type: 'string', description: 'GameObject / MonoScript / SceneAsset / etc.' },
      name: { type: 'string', description: 'Asset / GameObject name.' },
      instanceId: { type: 'integer' },
      active: { type: 'boolean' },
      tag: { type: 'string' },
      layer: { type: 'integer' },
      isStatic: { type: 'boolean' },
      transform: { type: 'object', description: 'Present when --include-transforms.' },
      components: { type: 'array', description: 'Each entry: { type, fullType, enabled, fields? }. Same shape as inspect_hierarchy.' },
      childCount: { type: 'integer' },
      children: { type: 'array', description: 'Recursive nodes — same shape. Absent when depth=0 or there are no children.' },
    },
  },
  examples: [
    {
      title: 'Inspect a prefab (positional path is also accepted)',
      cli: './bin/dreamer inspect Assets/Prefabs/Player.prefab --wait',
      args: { assetPath: 'Assets/Prefabs/Player.prefab' },
    },
    {
      title: 'Inspect with transforms (positions/scales per GO)',
      cli: './bin/dreamer inspect Assets/Prefabs/Enemy.prefab --include-transforms --wait',
      args: { assetPath: 'Assets/Prefabs/Enemy.prefab', includeTransforms: true },
    },
    {
      title: 'Inspect with field values (read all serialized fields)',
      cli: './bin/dreamer inspect Assets/Prefabs/Player.prefab --include-fields --wait',
      args: { assetPath: 'Assets/Prefabs/Player.prefab', includeFields: true },
    },
    {
      title: 'Inspect only the root (no children expansion)',
      cli: './bin/dreamer inspect Assets/Prefabs/Boss.prefab --depth 0 --wait',
      args: { assetPath: 'Assets/Prefabs/Boss.prefab', depth: 0 },
    },
    {
      title: 'Inspect a scene object',
      cli: './bin/dreamer inspect --scene-object "/Player" --include-transforms --wait',
      args: { sceneObjectPath: '/Player', includeTransforms: true },
    },
  ],
  pitfalls: [
    'Default recursion is UNLIMITED — large prefab trees produce large payloads. Use --depth N to cap.',
    'For multi-prefab comparisons, use `inspect-many --paths a.prefab,b.prefab` (single round-trip) instead of N inspect calls.',
    'To READ a single specific field value (one component, one property), `read-property` is cheaper than `inspect --include-fields` — it returns just that value.',
    'Component shape is `{type, fullType, enabled}` — same as `inspect-hierarchy`. NOT `{type, name}` (legacy shape, removed).',
  ],
};
