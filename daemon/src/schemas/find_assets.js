'use strict';

module.exports = {
  kind: 'find_assets',
  summary: 'Search the Unity project for assets by type, name pattern, or folder. Run this BEFORE referencing an asset by path to verify it exists. CLI verb: `find-assets`.',
  requirements: null,
  args: {
    type: {
      type: 'string',
      cli: '--type',
      description:
        'Asset type filter. Common values: prefab, script, scene, material, texture, shader, animation, animatorcontroller, scriptableobject, font, audioclip, model, sprite. ' +
        'Any other value is forwarded to Unity\'s AssetDatabase as `t:<type>` — pass any class name Unity recognizes (e.g. "TextAsset", "ComputeShader"). Defaults to "any".',
    },
    name: {
      type: 'string',
      cli: '--name',
      description: 'Name pattern; supports * wildcards (e.g. "Player*").',
    },
    path: {
      type: 'string',
      cli: '--path',
      description: 'Limit search to this folder (e.g. "Assets/Prefabs").',
    },
  },
  result: {
    type: 'object',
    fields: {
      assets: { type: 'array', description: 'Array of { path, guid, type, name } entries.' },
      count: { type: 'number' },
    },
  },
  examples: [
    {
      title: 'All prefabs in the project',
      cli: './bin/dreamer find-assets --type prefab --wait',
      args: { type: 'prefab' },
    },
    {
      title: 'Player-prefixed scripts in a specific folder',
      cli: './bin/dreamer find-assets --type script --name "Player*" --path Assets/Scripts --wait',
      args: { type: 'script', name: 'Player*', path: 'Assets/Scripts' },
    },
    {
      title: 'Find an asset by exact name (any type)',
      cli: './bin/dreamer find-assets --name "EnemyData" --wait',
      args: { name: 'EnemyData' },
    },
    {
      title: 'Discovery before set-property',
      cli: '# 1) confirm the prefab exists at the expected path\n./bin/dreamer find-assets --type prefab --name "Player" --wait\n# 2) inspect to find the right component\n./bin/dreamer inspect Assets/Prefabs/Player.prefab --wait\n# 3) mutate\n./bin/dreamer set-property --asset Assets/Prefabs/Player.prefab --component PlayerCtl --property speed --value 5 --wait',
      args: { type: 'prefab', name: 'Player' },
    },
  ],
  pitfalls: [
    'find-assets does NOT search names recursively across nested GameObjects inside scenes — that\'s `inspect-hierarchy`. find-assets searches ASSET FILES under Assets/.',
    'Pattern matching is FILENAME-only. To match path segments, use `--path` to scope.',
    'Returns up to 100 results by default. If you suspect there are more, narrow the filter.',
    'Result entries include both `path` and `guid` — pass either to subsequent commands. GUID is more durable across renames/moves.',
  ],
};
