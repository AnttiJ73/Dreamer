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
    {
      title: 'Spec from a file (better for big trees — quoting bash JSON inline is painful)',
      cli: './bin/dreamer create-hierarchy --save-path Assets/Prefabs --json @specs/enemy.json --wait',
      args: { name: '<from file>', savePath: 'Assets/Prefabs' },
      note: 'The @file form reads the JSON from disk. Big multi-level hierarchies get unreadable inline.',
    },
    {
      title: 'Deep tree with multiple component layers',
      cli: './bin/dreamer create-hierarchy --json @specs/boss.json --wait',
      args: {
        name: 'Boss',
        components: ['UnityEngine.Rigidbody2D', 'Game.BossAI'],
        children: [
          { name: 'Body', components: ['UnityEngine.SpriteRenderer', 'UnityEngine.BoxCollider2D'] },
          { name: 'Head', components: ['UnityEngine.SpriteRenderer'], children: [
            { name: 'EyeL', components: ['UnityEngine.SpriteRenderer'] },
            { name: 'EyeR', components: ['UnityEngine.SpriteRenderer'] },
          ]},
        ],
      },
    },
  ],
  pitfalls: [
    'ALWAYS check `compile-status` BEFORE create-hierarchy when the spec uses custom (Game.X) component types. If a script with the requested type has a compile error, ResolveType returns null and the component is silently skipped — the call still "succeeds" but the result\'s `warnings[]` lists what was dropped. INSPECT `warnings[]` after every call.',
    'Use `parentPath` (canonical) — `parent` is accepted as an alias with a warning, but the canonical key is `parentPath`. Don\'t mix both.',
    'For trees of more than ~3 nodes, write the JSON to a file and pass `@path/to/file.json` to --json. Inline shell-quoting of nested JSON is fragile.',
    'When `--save-path` is given, the spec\'s root becomes the prefab root, and a temp scene object is created and destroyed during the save. The destination filename is `<spec.name>.prefab`.',
    'Components on each node are added IN ORDER. If component A requires component B (RequireComponent), Unity will auto-add B; you don\'t need to list it.',
  ],
};
