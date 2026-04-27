'use strict';

module.exports = {
  kind: 'remove_sorting_layer',
  summary: "Remove a 2D sorting layer by name. CLI verb: `remove-sorting-layer`. The 'Default' layer is protected and cannot be removed.",
  requirements: null,
  args: { name: { type: 'string', required: true, cli: '--name' } },
  result: { type: 'object', fields: { name: { type: 'string' }, removed: { type: 'boolean' }, removedAtIndex: { type: 'integer' }, note: { type: 'string' } } },
  examples: [
    { title: 'Remove Foreground sorting layer', cli: './bin/dreamer remove-sorting-layer --name Foreground --wait', args: { name: 'Foreground' } },
  ],
};
