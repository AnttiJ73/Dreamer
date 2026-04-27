'use strict';

module.exports = {
  kind: 'remove_tag',
  summary:
    "Remove a tag from TagManager. CLI verb: `remove-tag`. No-op (removed: false) if the tag doesn't exist. " +
    "Builtin tags (Untagged, Respawn, Finish, EditorOnly, MainCamera, Player, GameController) are silently kept by Unity.",
  requirements: null,
  args: { name: { type: 'string', required: true, cli: '--name' } },
  result: { type: 'object', fields: { name: { type: 'string' }, removed: { type: 'boolean' }, note: { type: 'string' } } },
  examples: [
    { title: 'Remove Boss tag', cli: './bin/dreamer remove-tag --name Boss --wait', args: { name: 'Boss' } },
  ],
  pitfalls: [
    'GameObjects using the removed tag get their tag silently reset to Untagged — make sure no scene/prefab references it before removing.',
  ],
};
