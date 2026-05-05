'use strict';

module.exports = {
  kind: 'add_tag',
  summary: "Add a tag to TagManager. CLI verb: `add-tag`. No-op (added: false) if the tag already exists.",
  requirements: null,
  args: { name: { type: 'string', required: true, cli: '--name' } },
  result: { type: 'object', fields: { name: { type: 'string' }, added: { type: 'boolean' }, note: { type: 'string' } } },
  examples: [
    { title: 'Add Boss tag', cli: './bin/dreamer add-tag --name Boss --wait', args: { name: 'Boss' } },
  ],
};
