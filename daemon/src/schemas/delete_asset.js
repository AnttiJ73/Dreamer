'use strict';

const { commonArgs } = require('./_common');

module.exports = {
  kind: 'delete_asset',
  summary:
    'Delete a project asset (prefab, material, scriptable object, animation clip, etc.) via AssetDatabase.DeleteAsset. ' +
    'CLI verb: `delete-asset`. The .meta file is removed automatically. ' +
    'Use this instead of OS-level `rm` — it routes through Unity\'s code path so SourceAssetDB / activity log stay consistent.',
  requirements: null,
  args: {
    ...commonArgs.target(['asset', 'guid']),
    moveToTrash: {
      type: 'boolean',
      cli: '--trash',
      description: 'Move to OS trash instead of permanent delete (uses AssetDatabase.MoveAssetToTrash). Recoverable from the system trash. Default: false (permanent delete).',
    },
  },
  constraints: [commonArgs.targetAtLeastOne(['asset', 'guid'])],
  result: {
    type: 'object',
    fields: {
      deleted: { type: 'boolean' },
      assetPath: { type: 'string' },
      trashed: { type: 'boolean', description: 'True when --trash was passed and the file moved to the system trash; false on permanent delete.' },
    },
  },
  examples: [
    {
      title: 'Delete a prefab',
      cli: './bin/dreamer delete-asset --asset Assets/Prefabs/OldVariant.prefab --wait',
      args: { assetPath: 'Assets/Prefabs/OldVariant.prefab' },
    },
    {
      title: 'Soft-delete (recoverable) via OS trash',
      cli: './bin/dreamer delete-asset --asset Assets/Materials/Unused.mat --trash --wait',
      args: { assetPath: 'Assets/Materials/Unused.mat', moveToTrash: true },
    },
    {
      title: 'Delete by GUID',
      cli: './bin/dreamer delete-asset --asset 6c0666031cf658643abb3213c97a4bbe --wait',
      args: { guid: '6c0666031cf658643abb3213c97a4bbe' },
    },
  ],
  pitfalls: [
    'Permanent delete is NOT undoable from Unity. Use --trash if you might need to recover. The OS-trash variant is reversible from the system trash bin.',
    'Folders are accepted only if they are empty. To delete a folder with contents, delete its children first (loop find-assets --path FOLDER).',
    'Deleting an asset that is referenced elsewhere leaves dangling references (Missing in Inspector). dreamer does not scan for references first — verify with a find-references pass before destructive deletes.',
    'For GameObjects in scenes or prefabs, use delete-gameobject, not delete-asset. This command operates on asset FILES.',
  ],
  seeAlso: [
    './bin/dreamer help duplicate    — make a backup copy before destructive deletes.',
    './bin/dreamer help delete_gameobject — remove a GameObject from a scene or prefab.',
  ],
};
