'use strict';

const { commonArgs } = require('./_common');

module.exports = {
  kind: 'delete_gameobject',
  summary: 'Delete a GameObject from the active scene OR from inside a prefab. CLI verb: `delete-gameobject`. USE THIS instead of trying to clear m_IsActive, remove all components, or wire up an Editor menu item.',
  requirements: null,
  args: commonArgs.target(),
  constraints: [commonArgs.targetAtLeastOne()],
  result: {
    type: 'object',
    fields: {
      deleted: { type: 'boolean' },
      name: { type: 'string' },
      childrenAlsoDeleted: { type: 'integer', description: 'Direct child count of the destroyed GameObject (descendants deeper still go with them).' },
    },
  },
  examples: [
    {
      title: 'Delete a scene GameObject (and its descendants)',
      cli: './bin/dreamer delete-gameobject --scene-object "/UICanvas/OldPanel" --wait',
      args: { sceneObjectPath: '/UICanvas/OldPanel' },
    },
    {
      title: 'Delete a child inside a prefab',
      cli: './bin/dreamer delete-gameobject --asset Assets/Prefabs/Enemy.prefab --child-path "Visuals/Decorative" --wait',
      args: { assetPath: 'Assets/Prefabs/Enemy.prefab', childPath: 'Visuals/Decorative' },
    },
  ],
  pitfalls: [
    'CHILDREN ARE DELETED WITH THE PARENT — Unity\'s default. The result\'s `childrenAlsoDeleted` field reports the immediate child count (descendants deeper went with them).',
    'DO NOT try to "delete" a GameObject by setting `m_IsActive=false` — that just hides it. Delete actually removes it.',
    'Don\'t use `remove-component` to "delete" a GameObject by stripping all components. Required components (Transform, RectTransform) refuse to remove. Use this command.',
    'For prefab mode, you cannot delete the prefab ROOT via this command — pass `--child-path` to delete a child. To remove the prefab file itself, use Unity\'s asset operations or delete via filesystem (file-edit, then refresh-assets).',
    'After deleting in scene mode, `save-assets --wait` to persist. Otherwise the deletion only exists in-memory.',
    'Deleting a GO that\'s referenced elsewhere (other components\' fields, scene serialization) leaves dangling Missing references. If you intend a clean refactor, run `remove-missing-scripts` afterward to clean up.',
  ],
};
