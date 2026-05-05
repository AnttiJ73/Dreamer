'use strict';

module.exports = {
  kind: 'execute_menu_item',
  summary: 'Run a Unity Editor menu item by path (e.g. "GameObject/UI/Canvas", "Edit/Project Settings..."). CLI verb: `execute-menu-item`. Last-resort escape hatch — if there\'s a first-class Dreamer command for what you need, use that instead. Surface any missing first-class command to the user as an issue rather than papering over it with menu-item hacks (see `help conventions` → forbidden).',
  requirements: null,
  args: {
    menuItem: {
      type: 'string',
      required: true,
      cli: '(positional)',
      description: 'Slash-separated menu path. Passed positionally: `dreamer execute-menu-item "GameObject/UI/Canvas"`. Quote on the CLI because of the slash.',
    },
  },
  result: {
    type: 'object',
    fields: {
      executed: { type: 'boolean' },
      menuItem: { type: 'string' },
    },
  },
  examples: [
    {
      title: 'Open a settings window',
      cli: './bin/dreamer execute-menu-item "Edit/Project Settings..." --wait',
      args: { menuItem: 'Edit/Project Settings...' },
    },
  ],
};
