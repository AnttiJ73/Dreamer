'use strict';

module.exports = {
  kind: 'add_sorting_layer',
  summary:
    "Append a 2D sorting layer to TagManager. CLI verb: `add-sorting-layer`. " +
    "Sorting layers control 2D render order. The new layer is appended to the end (highest sort order). " +
    "No-op (added: false) if a layer with that name already exists.",
  requirements: null,
  args: { name: { type: 'string', required: true, cli: '--name' } },
  result: { type: 'object', fields: { name: { type: 'string' }, added: { type: 'boolean' }, index: { type: 'integer' }, note: { type: 'string' } } },
  examples: [
    { title: 'Add a Foreground sorting layer', cli: './bin/dreamer add-sorting-layer --name Foreground --wait', args: { name: 'Foreground' } },
  ],
  pitfalls: [
    'Reordering existing sorting layers is not exposed yet — manage order via the editor or use set-project-setting --file TagManager --property m_SortingLayers as an escape hatch.',
  ],
};
