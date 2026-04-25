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
      cli: './bin/dreamer create-ui-tree --wait --json \'{"mode":"create","canvas":{"name":"MainMenu","renderMode":"overlay"},"tree":{"type":"VStack","name":"Menu","anchor":"center","size":[400,400],"padding":20,"spacing":10,"children":[{"type":"Text","text":"My Game","fontSize":32,"size":[0,48],"alignment":"middle-center"},{"type":"Button","name":"PlayBtn","text":"Play","size":[0,48]}]}}\'',
      args: { mode: 'create', canvas: { name: 'MainMenu', renderMode: 'overlay' }, tree: { type: 'VStack', name: 'Menu', anchor: 'center', size: [400, 400], padding: 20, spacing: 10, children: [{ type: 'Text', text: 'My Game', fontSize: 32, size: [0, 48], alignment: 'middle-center' }, { type: 'Button', name: 'PlayBtn', text: 'Play', size: [0, 48] }] } },
    },
    {
      title: 'Replace a panel\'s children',
      cli: './bin/dreamer create-ui-tree --wait --json @.tmp_ui/panel.json',
      args: { mode: 'replace-children', target: '/MainCanvas/Menu', tree: { type: 'VStack', children: [] } },
    },
  ],
};
