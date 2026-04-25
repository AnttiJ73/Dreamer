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
      title: 'Default — save scenes + assets',
      cli: './bin/dreamer save-assets --wait',
      args: {},
    },
  ],
};
