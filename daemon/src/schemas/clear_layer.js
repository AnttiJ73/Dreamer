'use strict';

module.exports = {
  kind: 'clear_layer',
  summary:
    "Clear a layer slot (set name to empty). CLI verb: `clear-layer`. Builtin layers (0-7) require `--force`.",
  requirements: null,
  args: {
    index: { type: 'integer', required: true, cli: '--index' },
    force: { type: 'boolean', cli: '--force' },
  },
  result: { type: 'object', fields: { index: { type: 'integer' }, previousName: { type: 'string' }, cleared: { type: 'boolean' } } },
  examples: [
    { title: 'Clear layer 8', cli: './bin/dreamer clear-layer --index 8 --wait', args: { index: 8 } },
  ],
};
