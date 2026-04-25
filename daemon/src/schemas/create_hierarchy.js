'use strict';

module.exports = {
  kind: 'create_hierarchy',
  summary: 'Build a tree of GameObjects from a declarative JSON spec. ONE call replaces dozens of create-gameobject + add-component + set-property calls. CLI verb: `create-hierarchy`. Two modes: pass --save-path to save the tree as a prefab asset; omit it to build into the active scene.',
  requirements: null,
  args: {
    name: {
      type: 'string',
      description: 'Root GameObject name (top of the tree). Set inside the --json payload.',
    },
    parentPath: {
      type: 'string',
      description: 'Optional parent scene path (scene mode). Set inside the --json payload. Accepts "parent" as alias.',
    },
    components: {
      type: 'array',
      description: 'List of component types to add to a node, e.g. ["UnityEngine.Rigidbody2D", "Game.PlayerController"]. Per-node, inside the --json payload.',
    },
    children: {
      type: 'array',
      description: 'Nested child nodes, recursively. Each child node has the same shape as the root: { name, components?, children? }.',
    },
    savePath: {
      type: 'string',
      cli: '--save-path',
      description: 'Folder path under Assets/. When set, the built hierarchy is saved as a prefab `<name>.prefab` in that folder, and the temp scene object is destroyed. Omit to leave the tree in the active scene.',
    },
    json: {
      type: 'string',
      cli: '--json',
      description: 'The declarative tree spec. Pass JSON inline or as `@path/to/file.json`. Top-level keys: name, components?, children?, parent? / parentPath?.',
    },
  },
  result: {
    type: 'object',
    fields: {
      created: { type: 'boolean' },
      rootPath: { type: 'string', description: 'Scene path of the new tree (scene mode).' },
      assetPath: { type: 'string', description: 'Saved prefab path (when --save-path given).' },
      warnings: { type: 'array', description: 'Reasons individual components couldn\'t be added (unknown type, not a Component, duplicate). Most common cause: requested type is in a script with a current compile error → check `compile-status` first.' },
    },
  },
  examples: [
    {
      title: 'Build a small Player rig in the active scene',
      cli: './bin/dreamer create-hierarchy --json \'{"name":"Player","components":["UnityEngine.Rigidbody2D","Game.PlayerController"],"children":[{"name":"Visuals","components":["UnityEngine.SpriteRenderer"]},{"name":"GunMount"}]}\' --wait',
      args: { name: 'Player', components: ['UnityEngine.Rigidbody2D', 'Game.PlayerController'], children: [{ name: 'Visuals', components: ['UnityEngine.SpriteRenderer'] }, { name: 'GunMount' }] },
    },
    {
      title: 'Save the same hierarchy as a prefab',
      cli: './bin/dreamer create-hierarchy --save-path Assets/Prefabs --json \'{"name":"Player","components":["UnityEngine.Rigidbody2D"],"children":[{"name":"Visuals","components":["UnityEngine.SpriteRenderer"]}]}\' --wait',
      args: { name: 'Player', savePath: 'Assets/Prefabs', components: ['UnityEngine.Rigidbody2D'], children: [{ name: 'Visuals', components: ['UnityEngine.SpriteRenderer'] }] },
    },
  ],
};
