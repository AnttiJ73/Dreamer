'use strict';

const { commonArgs } = require('./_common');

module.exports = {
  kind: 'inspect_asset',
  summary: 'Read an asset\'s structure: components on a prefab (with serialized field values when --component is given), shader/properties on a material, fields on a ScriptableObject. Run BEFORE mutating to verify paths and component types. CLI verb: `inspect`.',
  requirements: null,
  args: {
    ...commonArgs.target(['asset', 'guid', 'child']),
    component: {
      type: 'string',
      cli: '--component',
      description: 'Filter the inspection to one component by full type name. Without this, all components are returned.',
    },
  },
  constraints: [commonArgs.targetAtLeastOne(['asset', 'guid'])],
  result: {
    type: 'object',
    fields: {
      assetPath: { type: 'string' },
      assetType: { type: 'string', description: 'Prefab / ScriptableObject / Material / etc.' },
      components: { type: 'array', description: 'For prefabs: component type list, with serialized fields when --component is given.' },
      children: { type: 'array', description: 'For prefabs: nested GameObjects, each with childPath, components, and recurse.' },
    },
  },
  examples: [
    {
      title: 'Inspect a prefab (positional path is also accepted)',
      cli: './bin/dreamer inspect Assets/Prefabs/Player.prefab --wait',
      args: { assetPath: 'Assets/Prefabs/Player.prefab' },
    },
    {
      title: 'Inspect a child inside a prefab',
      cli: './bin/dreamer inspect --asset Assets/Prefabs/Enemy.prefab --child-path "Visuals/Body" --wait',
      args: { assetPath: 'Assets/Prefabs/Enemy.prefab', childPath: 'Visuals/Body' },
    },
    {
      title: 'Filter to one component',
      cli: './bin/dreamer inspect --asset Assets/Prefabs/Player.prefab --component Game.PlayerController --wait',
      args: { assetPath: 'Assets/Prefabs/Player.prefab', component: 'Game.PlayerController' },
    },
  ],
};
