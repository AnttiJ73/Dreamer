'use strict';

module.exports = {
  kind: 'add_child_to_prefab',
  summary: 'Add an empty child GameObject inside an existing prefab. CLI verb: `add-child-to-prefab`. For populating the new child with components afterward, use `add-component --asset PREFAB --child-path NEW_CHILD_PATH`. For creating a NEW prefab from scratch with a tree of children, use create-hierarchy --save-path.',
  requirements: null,
  args: {
    assetPath: {
      type: 'string',
      cli: '--asset',
      description: 'Path to the .prefab to modify.',
    },
    guid: {
      type: 'string',
      cli: '--asset (GUID form)',
      description: 'Prefab GUID — alternative to assetPath; auto-detected when --asset is 32 hex chars.',
    },
    childName: {
      type: 'string',
      required: true,
      cli: '--child-name',
      description: 'Name of the new child GameObject.',
    },
    parentPath: {
      type: 'string',
      cli: '--parent-path',
      description: 'Slash-separated path inside the prefab to attach the new child under (e.g. "Visuals/Body"). Empty / unset → prefab root.',
    },
  },
  constraints: [{ rule: 'atLeastOne', fields: ['assetPath', 'guid'] }],
  result: {
    type: 'object',
    fields: {
      added: { type: 'boolean' },
      childPath: { type: 'string', description: 'Resulting prefab-relative path of the new child.' },
      assetPath: { type: 'string' },
    },
  },
  examples: [
    {
      title: 'Add an empty child to a prefab root',
      cli: './bin/dreamer add-child-to-prefab --asset Assets/Prefabs/Enemy.prefab --child-name Visuals --wait',
      args: { assetPath: 'Assets/Prefabs/Enemy.prefab', childName: 'Visuals' },
    },
    {
      title: 'Add a child under a nested node',
      cli: './bin/dreamer add-child-to-prefab --asset Assets/Prefabs/Enemy.prefab --child-name Body --parent-path "Visuals" --wait',
      args: { assetPath: 'Assets/Prefabs/Enemy.prefab', childName: 'Body', parentPath: 'Visuals' },
    },
  ],
};
