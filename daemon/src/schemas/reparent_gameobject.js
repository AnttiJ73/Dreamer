'use strict';

module.exports = {
  kind: 'reparent_gameobject',
  summary: 'Move a GameObject under a new parent — in the active scene OR inside a prefab. Equivalent to drag-and-drop in Unity\'s Hierarchy / Prefab Mode window.',
  requirements: null,
  args: {
    sceneObjectPath: {
      type: 'string',
      cli: '--scene-object',
      description: 'Scene mode: path / name of the GameObject to move. CLI: --scene-object',
    },
    assetPath: {
      type: 'string',
      cli: '--asset',
      description: 'Prefab mode: path to the prefab asset whose hierarchy you\'re editing. CLI: --asset',
    },
    guid: {
      type: 'string',
      cli: '--asset (GUID form)',
      description: 'Asset GUID (alternative to assetPath). CLI: --asset',
    },
    childPath: {
      type: 'string',
      cli: '--child-path',
      description: 'Prefab mode ONLY: slash-separated path of the GameObject to move, relative to the prefab root (e.g. "Visuals/Body"). Required for prefab mode. CLI: --child-path',
    },
    newParentPath: {
      type: 'string',
      cli: '--new-parent',
      description: 'Path of the new parent. Scene mode: an absolute scene path. Prefab mode: relative to the prefab root. Omit / pass empty to move to the root (scene root or prefab root depending on mode). CLI: --new-parent',
    },
    keepWorldSpace: {
      type: 'boolean',
      cli: '--keep-world-space',
      description: 'When true, the GO\'s world position/rotation/scale stay constant while its local transform is recomputed under the new parent. Default false (preserve local transform — visual position changes if the new parent has a different world transform). CLI: --keep-world-space true|false',
    },
    siblingIndex: {
      type: 'integer',
      cli: '--sibling-index',
      description: 'Optional: place the moved GO at this sibling slot under the new parent (0 = first). Out-of-range values are clamped. CLI: --sibling-index N',
    },
  },
  constraints: [
    { rule: 'atLeastOne', fields: ['sceneObjectPath', 'assetPath', 'guid'] },
  ],
  result: {
    type: 'object',
    fields: {
      reparented: { type: 'boolean' },
      mode: { type: 'string', description: '"scene" or "prefab".' },
      oldParentPath: { type: 'string' },
      newParentPath: { type: 'string' },
      keepWorldSpace: { type: 'boolean' },
    },
  },
  examples: [
    {
      title: 'Reparent in scene under a new parent',
      cli: './bin/dreamer reparent --scene-object "/Visuals/SpriteHolder" --new-parent "/Body" --wait',
      args: { sceneObjectPath: '/Visuals/SpriteHolder', newParentPath: '/Body' },
    },
    {
      title: 'Reparent in scene to scene root (omit --new-parent)',
      cli: './bin/dreamer reparent --scene-object "/Body/Stray" --wait',
      args: { sceneObjectPath: '/Body/Stray' },
    },
    {
      title: 'Reparent inside a prefab (paths relative to prefab root)',
      cli: './bin/dreamer reparent --asset Assets/Prefabs/Enemy.prefab --child-path "Visuals/Body" --new-parent "Bones/Root" --wait',
      args: { assetPath: 'Assets/Prefabs/Enemy.prefab', childPath: 'Visuals/Body', newParentPath: 'Bones/Root' },
    },
    {
      title: 'Reparent inside a prefab to the prefab root',
      cli: './bin/dreamer reparent --asset Assets/Prefabs/Enemy.prefab --child-path "Visuals/Decorative/Detail" --wait',
      args: { assetPath: 'Assets/Prefabs/Enemy.prefab', childPath: 'Visuals/Decorative/Detail' },
    },
  ],
};
