'use strict';

module.exports = {
  kind: 'set_layer_name',
  summary:
    "Rename a Unity physics/rendering layer. CLI verb: `set-layer-name`. " +
    "Layers 0-7 are builtin (Default, TransparentFX, Ignore Raycast, Water, UI, …) and are " +
    "rejected unless `--force` is passed — modifying them breaks engine assumptions.",
  requirements: null,
  args: {
    index: { type: 'integer', required: true, cli: '--index', description: '0..31. 8..31 are user layers.' },
    name: { type: 'string', required: true, cli: '--name', description: 'New layer name. Empty string clears the slot (or use clear-layer).' },
    force: { type: 'boolean', cli: '--force', description: 'Required to modify a builtin layer (index 0..7).' },
  },
  result: {
    type: 'object',
    fields: {
      index: { type: 'integer' },
      previousName: { type: 'string' },
      name: { type: 'string' },
    },
  },
  examples: [
    {
      title: 'Name layer 8 "Walkable"',
      cli: './bin/dreamer set-layer-name --index 8 --name Walkable --wait',
      args: { index: 8, name: 'Walkable' },
    },
  ],
  pitfalls: [
    'Renaming a layer used by existing GameObjects keeps their numeric layer assignment but changes the displayed name — code referencing `LayerMask.NameToLayer("OldName")` will break.',
  ],
};
