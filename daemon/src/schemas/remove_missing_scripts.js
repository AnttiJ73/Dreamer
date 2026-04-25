'use strict';

const { commonArgs } = require('./_common');

module.exports = {
  kind: 'remove_missing_scripts',
  summary: 'Strip "Missing (Mono Script)" component slots from a prefab, scene object, or every prefab under a folder. CLI verb: `remove-missing-scripts`. Common after deleting / renaming a MonoBehaviour script — Unity leaves placeholder Missing entries on every GameObject that referenced it.',
  requirements: null,
  args: {
    ...commonArgs.target(['asset', 'guid', 'scene']),
    path: {
      type: 'string',
      cli: '--path',
      description: 'Folder under Assets/ to scan recursively for prefabs with missing scripts. Mutually exclusive with --asset / --scene-object.',
    },
    dryRun: {
      type: 'boolean',
      cli: '--dry-run',
      description: 'Report what would be removed without modifying anything.',
    },
    recursive: {
      type: 'boolean',
      cli: '--non-recursive',
      description: 'When false (--non-recursive given), only the named folder is scanned, not subfolders. Default true. Only meaningful with --path.',
    },
  },
  constraints: [{ rule: 'atLeastOne', fields: ['assetPath', 'guid', 'sceneObjectPath', 'path'] }],
  result: {
    type: 'object',
    fields: {
      removed: { type: 'integer' },
      affected: { type: 'array' },
    },
  },
  examples: [
    {
      title: 'Strip missing scripts from one prefab',
      cli: './bin/dreamer remove-missing-scripts --asset Assets/Prefabs/Player.prefab --wait',
      args: { assetPath: 'Assets/Prefabs/Player.prefab' },
    },
    {
      title: 'Scan a folder, dry-run',
      cli: './bin/dreamer remove-missing-scripts --path Assets/Prefabs --dry-run --wait',
      args: { path: 'Assets/Prefabs', dryRun: true },
    },
  ],
};
