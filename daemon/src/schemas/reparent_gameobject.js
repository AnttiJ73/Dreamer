'use strict';

const { commonArgs } = require('./_common');

module.exports = {
  kind: 'reparent_gameobject',
  summary: 'Move a GameObject under a new parent — in the active scene OR inside a prefab. CLI verb: `reparent`. Equivalent to drag-and-drop in Unity\'s Hierarchy / Prefab Mode window.',
  requirements: null,
  args: {
    ...commonArgs.target(),
    newParentPath: {
      type: 'string',
      cli: '--new-parent',
      description: 'Path of the new parent. Scene mode: absolute scene path. Prefab mode: relative to the prefab root. Omit / pass empty to move to the root (scene root or prefab root depending on mode).',
    },
    keepWorldSpace: {
      type: 'boolean',
      cli: '--keep-world-space',
      description: 'When true, the GO\'s world position/rotation/scale stay constant while its local transform is recomputed under the new parent. Default false (preserve local transform — visual position changes if the new parent has a different world transform).',
    },
    siblingIndex: {
      type: 'integer',
      cli: '--sibling-index',
      description: 'Place the moved GO at this sibling slot under the new parent (0 = first). Out-of-range values are clamped.',
    },
  },
  constraints: [commonArgs.targetAtLeastOne()],
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
      title: 'Reparent + place at a specific sibling slot under new parent',
      cli: './bin/dreamer reparent --scene-object "/Inventory/NewItem" --new-parent "/Inventory/Slots" --sibling-index 0 --wait',
      args: { sceneObjectPath: '/Inventory/NewItem', newParentPath: '/Inventory/Slots', siblingIndex: 0 },
    },
    {
      title: 'Reparent while keeping world position (Alt-drag equivalent)',
      cli: './bin/dreamer reparent --scene-object "/SpawnedEnemy" --new-parent "/Enemies" --keep-world-space true --wait',
      args: { sceneObjectPath: '/SpawnedEnemy', newParentPath: '/Enemies', keepWorldSpace: true },
    },
  ],
  pitfalls: [
    'In PREFAB mode, --new-parent is RELATIVE TO THE PREFAB ROOT (no leading slash). Passing "/Bones/Root" with --asset will error — use "Bones/Root".',
    'In SCENE mode, --new-parent is an absolute scene path with leading slash: "/Body", "/UICanvas/Panel".',
    'CYCLE GUARD: Dreamer refuses to reparent a GO under itself or any of its descendants. The error message lists the descendant chain — if you hit this, the new-parent path is wrong.',
    'Default `keepWorldSpace=false` preserves LOCAL transform — the GO will visually JUMP to wherever the new parent\'s transform places it. Pass `--keep-world-space true` to keep its on-screen position constant (Unity Hierarchy\'s Alt-drag behavior).',
    'After reparenting in scene mode, REMEMBER to `save-assets --wait` to persist. The hierarchy change is in-memory until you save.',
    'For "move every X under Y" bulk operations, call reparent once per GO. There\'s no batch flag.',
  ],
};
