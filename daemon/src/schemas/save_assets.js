'use strict';

module.exports = {
  kind: 'save_assets',
  summary: 'Persist editor state to disk: dirty open scenes (EditorSceneManager.SaveOpenScenes) AND ScriptableObjects/prefabs/materials/etc. (AssetDatabase.SaveAssets). CLI verb: `save-assets`. CALL THIS after any scene-object mutation (set-property, add-component, create-gameobject on a scene path) — without it, the .unity file does NOT update on disk and `git diff` will show no scene change.',
  requirements: null,
  args: {
    skipScenes: {
      type: 'boolean',
      description: 'When true, only save assets (legacy AssetDatabase.SaveAssets behaviour). Set inside --json or as a structured payload. Rare.',
    },
    skipAssets: {
      type: 'boolean',
      description: 'When true, only save scenes. Rare.',
    },
  },
  result: {
    type: 'object',
    fields: {
      saved: { type: 'boolean' },
      savedScenes: { type: 'integer', description: 'Number of dirty open scenes that were saved.' },
      savedAssets: { type: 'boolean' },
      scenePaths: { type: 'array', description: 'Asset paths of the saved scenes.' },
    },
  },
  examples: [
    {
      title: 'Default — save scenes + assets in one call',
      cli: './bin/dreamer save-assets --wait',
      args: {},
    },
    {
      title: 'Routine after a scene mutation',
      cli: '# After: set-property --scene-object Player --component PlayerCtl --property speed --value 7 --wait\n./bin/dreamer save-assets --wait',
      args: {},
    },
  ],
  pitfalls: [
    'DO NOT follow `save-assets` with `save-scene`. `save-assets` already covers BOTH dirty scenes and asset files. Calling save-scene afterward is redundant.',
    'Older Dreamer versions (pre-fix) only ran AssetDatabase.SaveAssets and DID NOT persist scene mutations. If you\'re on an old version and `git diff` shows no scene changes after a successful save-assets, run `./bin/dreamer update` and retry. Current behavior covers both.',
    'Use `save-scene --path Assets/Scenes/X.unity` (NOT save-assets) when you need save-AS to a different path. save-assets only saves in-place.',
    'If `savedScenes: 0` in the result, no scene was dirty — the call was a no-op for scenes. That\'s normal when only asset files (prefabs/materials) changed.',
  ],
};
