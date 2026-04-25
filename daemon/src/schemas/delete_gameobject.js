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
};
