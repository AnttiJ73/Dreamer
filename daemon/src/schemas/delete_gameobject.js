'use strict';

module.exports = {
  kind: 'delete_gameobject',
  summary: 'Delete a GameObject from the active scene OR from inside a prefab. USE THIS instead of trying to clear m_IsActive, remove all components, or wire up an Editor menu item — none of those work.',
  requirements: null,
  args: {
    sceneObjectPath: {
      type: 'string',
      cli: '--scene-object',
      description: 'Path / name of the scene GameObject to delete. Children are destroyed with the parent (Unity default). CLI: --scene-object',
    },
    assetPath: {
      type: 'string',
      cli: '--asset',
      description: 'Path to a prefab asset; combined with --child-path, deletes a child inside the prefab. CLI: --asset',
    },
    guid: {
      type: 'string',
      cli: '--asset (GUID form)',
      description: 'Asset GUID (alternative to assetPath). CLI: --asset',
    },
    childPath: {
      type: 'string',
      cli: '--child-path',
      description: 'For prefab mode: slash-separated path of the child to delete (relative to the prefab root). Required for prefab mode (deleting the prefab root via this command is not supported — delete the .prefab file instead). CLI: --child-path',
    },
  },
  constraints: [
    { rule: 'atLeastOne', fields: ['sceneObjectPath', 'assetPath', 'guid'] },
  ],
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
