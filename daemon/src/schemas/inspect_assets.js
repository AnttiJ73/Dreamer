'use strict';

module.exports = {
  kind: 'inspect_assets',
  summary: 'Bulk-inspect N assets in ONE round-trip. Same options as `inspect`, results returned as an array in path order. CLI verb: `inspect-many`.',
  requirements: null,
  args: {
    paths: {
      type: 'array',
      required: true,
      cli: '--paths',
      description: 'Comma-separated asset paths on the CLI: `--paths Assets/Prefabs/A.prefab,Assets/Prefabs/B.prefab`. As a JSON arg: `["Assets/Prefabs/A.prefab","Assets/Prefabs/B.prefab"]`.',
    },
    depth: {
      type: 'integer',
      cli: '--depth',
      description: 'Children recursion depth for each item. -1 = unlimited (default), 0 = root only.',
    },
    includeTransforms: {
      type: 'boolean',
      cli: '--include-transforms',
      description: 'When set, every node gets a `transform` object.',
    },
    includeFields: {
      type: 'boolean',
      cli: '--include-fields',
      description: 'When set, every component gets a `fields` array with serialized values.',
    },
  },
  result: {
    type: 'object',
    fields: {
      count: { type: 'integer', description: 'Total inputs.' },
      succeeded: { type: 'integer' },
      failed: { type: 'integer' },
      items: { type: 'array', description: 'Per-path result. Success: same shape as inspect_asset. Failure: `{ path, error }`. Order matches input.' },
    },
  },
  examples: [
    {
      title: 'Compare transforms across an enemy prefab family',
      cli: './bin/dreamer inspect-many --paths "Assets/Prefabs/Enemies/Rat.prefab,Assets/Prefabs/Enemies/Spider.prefab,Assets/Prefabs/Enemies/Slime.prefab" --include-transforms --wait',
      args: { paths: ['Assets/Prefabs/Enemies/Rat.prefab', 'Assets/Prefabs/Enemies/Spider.prefab', 'Assets/Prefabs/Enemies/Slime.prefab'], includeTransforms: true },
    },
    {
      title: 'Audit all card prefabs (root only — fast)',
      cli: './bin/dreamer inspect-many --paths "Assets/Prefabs/Cards/A.prefab,Assets/Prefabs/Cards/B.prefab" --depth 0 --wait',
      args: { paths: ['Assets/Prefabs/Cards/A.prefab', 'Assets/Prefabs/Cards/B.prefab'], depth: 0 },
    },
    {
      title: 'Read all field values for a list of prefabs',
      cli: './bin/dreamer inspect-many --paths "Assets/Prefabs/A.prefab,Assets/Prefabs/B.prefab" --include-fields --wait',
      args: { paths: ['Assets/Prefabs/A.prefab', 'Assets/Prefabs/B.prefab'], includeFields: true },
    },
  ],
  pitfalls: [
    'Single round-trip — much faster than N parallel `inspect` calls because Unity runs commands sequentially anyway.',
    'Failed items DO NOT abort the batch. Each failure becomes `{path, error}` in `items[]`. Always check `failed` count.',
    'Order is preserved — items[i] corresponds to paths[i] regardless of success/failure.',
    'Use `find-assets` first if you want to scope by glob (`--name "Enemy*"`) — chain its output into `inspect-many`.',
  ],
};
