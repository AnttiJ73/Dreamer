'use strict';

module.exports = {
  kind: 'inspect_ui_tree',
  summary: 'Read an existing uGUI tree back as the same JSON schema create-ui-tree consumes. CLI verb: `inspect-ui-tree`. Use BEFORE editing a UI so you can supply replace-children or replace-self with a complete spec.',
  requirements: null,
  args: {
    target: {
      type: 'string',
      required: true,
      cli: '--target',
      description: 'Scene path of the UI root to inspect, e.g. "/MainCanvas/Menu". Pass MSYS_NO_PATHCONV=1 on Git Bash to avoid the leading-slash mangling.',
    },
    depth: {
      type: 'integer',
      cli: '--depth',
      description: 'Limit recursion depth. Default: unlimited.',
    },
    includeRaw: {
      type: 'boolean',
      cli: '--include-raw',
      description: 'When true, include the raw RectTransform / serialized component dumps in addition to the schema form.',
    },
    includeRect: {
      type: 'boolean',
      cli: '--include-rect',
      description: 'When true, include resolved RectTransform values (anchorMin/Max, pivot, sizeDelta, anchoredPosition, computed anchor preset name) per node.',
    },
  },
  result: {
    type: 'object',
    fields: {
      inspected: { type: 'boolean' },
      rootPath: { type: 'string' },
      tree: { type: 'object', description: 'Recursive tree mirroring create-ui-tree\'s spec shape.' },
    },
  },
  examples: [
    {
      title: 'Read a UI tree',
      cli: './bin/dreamer inspect-ui-tree --target /MainCanvas/Menu --wait',
      args: { target: '/MainCanvas/Menu' },
    },
    {
      title: 'Read with rect data for layout debugging',
      cli: './bin/dreamer inspect-ui-tree --target /MainCanvas/Menu --include-rect true --wait',
      args: { target: '/MainCanvas/Menu', includeRect: true },
    },
  ],
};
