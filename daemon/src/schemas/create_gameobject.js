'use strict';

module.exports = {
  kind: 'create_gameobject',
  summary: 'Create a single empty GameObject in the active scene. CLI verb: `create-gameobject`. For trees of multiple GameObjects, prefer `create-hierarchy` (one declarative JSON tree, one call). Scene-only — to add a GameObject inside a prefab, use `create-hierarchy --save-path` or `add-child-to-prefab`.',
  requirements: null,
  args: {
    name: {
      type: 'string',
      cli: '--name',
      description: 'GameObject name. Defaults to "GameObject" if omitted.',
    },
    parentPath: {
      type: 'string',
      cli: '--parent',
      description: 'Optional parent scene path (e.g. "/UICanvas/Panel"). Empty / unset → scene root. Accepts "parent" as an alias in --json submissions; canonical key is "parentPath".',
    },
    scene: {
      type: 'string',
      cli: '--scene',
      description: 'Name of an open scene to target when multiple are loaded. Default: active scene.',
    },
  },
  result: {
    type: 'object',
    fields: {
      name: { type: 'string' },
      instanceId: { type: 'integer' },
      path: { type: 'string', description: 'Resolved scene path of the new GameObject.' },
    },
  },
  examples: [
    {
      title: 'Create at scene root',
      cli: './bin/dreamer create-gameobject --name Player --wait',
      args: { name: 'Player' },
    },
    {
      title: 'Create under a parent',
      cli: './bin/dreamer create-gameobject --name HealthBar --parent "/UICanvas/HUD" --wait',
      args: { name: 'HealthBar', parentPath: '/UICanvas/HUD' },
    },
  ],
};
