'use strict';

module.exports = {
  kind: 'create_ui_tree',
  summary: 'Build / replace a Canvas (uGUI) UI from a declarative JSON tree. CLI verb: `create-ui-tree`. The DEFAULT path for any uGUI work — menus, HUDs, panels, buttons, scroll views, dropdowns, sliders. Requires the `com.dreamer.agent-bridge.ugui` add-on package; if missing, the CLI returns "Unknown command kind". Full schema reference: see the `dreamer-ugui` skill\'s schema.md.',
  requirements: null,
  args: {
    mode: {
      type: 'string',
      enum: ['create', 'append', 'replace-children', 'replace-self'],
      description: 'How to apply the tree. "create" makes a new Canvas; "append" adds the tree as a child of `target`; "replace-children" clears `target`\'s children and rebuilds; "replace-self" removes `target` and puts the tree in its place.',
    },
    target: {
      type: 'string',
      description: 'Scene path required for non-create modes. The Canvas / GameObject that the tree attaches to.',
    },
    canvas: {
      type: 'object',
      description: '"create" mode only: { name, renderMode: "overlay"|"camera"|"world", sortOrder?, ... }.',
    },
    tree: {
      type: 'object',
      description: 'The widget tree. Each node: { type, name?, anchor?, size?, pivot?, offset?, margin?, ...type-specific fields, children?: [...] }. Supported types: Panel, VStack, HStack, Grid, ScrollList (containers); Text, Button, Image, Slider, Toggle, InputField, Dropdown, Spacer, Raw (leaves).',
    },
  },
  result: {
    type: 'object',
    fields: {
      created: { type: 'boolean' },
      rootPath: { type: 'string' },
      childrenRemoved: { type: 'integer' },
      warnings: { type: 'array', description: 'Schema-flagged issues that compile but render wrong.' },
    },
  },
  examples: [
    {
      title: 'Create a new menu Canvas',
      cli: './bin/dreamer create-ui-tree --wait --json \'{"mode":"create","canvas":{"name":"MainMenu","renderMode":"overlay"},"tree":{"type":"VStack","name":"Menu","anchor":"center","size":[400,400],"padding":20,"spacing":10,"children":[{"type":"Text","text":"My Game","fontSize":32,"size":[0,48],"alignment":"middle-center"},{"type":"Button","name":"PlayBtn","label":"Play","size":[0,48]}]}}\'',
      args: { mode: 'create', canvas: { name: 'MainMenu', renderMode: 'overlay' }, tree: { type: 'VStack', name: 'Menu', anchor: 'center', size: [400, 400], padding: 20, spacing: 10, children: [{ type: 'Text', text: 'My Game', fontSize: 32, size: [0, 48], alignment: 'middle-center' }, { type: 'Button', name: 'PlayBtn', label: 'Play', size: [0, 48] }] } },
    },
    {
      title: 'Replace a panel\'s children (preserves the canvas envelope, rebuilds inside)',
      cli: './bin/dreamer create-ui-tree --wait --json @.tmp_ui/panel.json',
      args: { mode: 'replace-children', target: '/MainCanvas/Menu', tree: { type: 'VStack', children: [] } },
    },
    {
      title: 'Append into an existing canvas',
      cli: './bin/dreamer create-ui-tree --wait --json \'{"mode":"append","target":"/GameUI","tree":{"type":"Panel","name":"Notifications","anchor":"top-stretch","size":[0,80],"children":[]}}\'',
      args: { mode: 'append', target: '/GameUI', tree: { type: 'Panel', name: 'Notifications', anchor: 'top-stretch', size: [0, 80], children: [] } },
    },
    {
      title: 'Iterate on existing UI: inspect → edit JSON → replace-children',
      cli: '# 1) read current\n./bin/dreamer inspect-ui-tree --target /MainCanvas/Menu --wait > current.json\n# 2) edit current.json\n# 3) rebuild that subtree\n./bin/dreamer create-ui-tree --wait --json @current.json',
      args: { mode: 'replace-children', target: '/MainCanvas/Menu', tree: { type: 'VStack' } },
    },
  ],
  pitfalls: [
    'On Git Bash (MSYS), --target paths starting with / get path-mangled by MSYS. Set MSYS_NO_PATHCONV=1 or use the // double-slash prefix to disable conversion.',
    'ALWAYS check the result\'s `warnings[]` after every call — schema flags things that compile but render wrong (e.g. invalid anchor preset, missing required field on a widget).',
    'Default to `ScrollList` for any list or growable content. Don\'t hand-roll a Mask + Content with a LayoutGroup; the schema\'s ScrollList does the right thing including the cross-axis fitter.',
    'Pick `anchored` (fixed position via anchor preset) OR `LayoutGroup` (parent flex distribution) per container. Don\'t mix on the same node.',
    'In a LayoutGroup, set `size` on every child. `[0, 0]` or omitted means "fill via flex"; `[w, h]` means "fixed". One flex child per axis (header fixed + content flex + footer fixed is the universal pattern).',
    'Use `replace-children` to iterate on an existing canvas without losing the canvas object\'s wiring. `replace-self` deletes the target and puts the tree where it was.',
    'For deeply-nested specs, write the JSON to a file and use `--json @file.json`. Inline shell-quoting of nested objects is fragile.',
  ],
};
