'use strict';

module.exports = {
  kind: 'inspect_hierarchy',
  summary: 'Dump the active scene\'s GameObject hierarchy: every root object, their children recursively, plus a component type list per node. CLI verb: `inspect-hierarchy`. Use BEFORE scene mutations to verify a scene path exists, and to look up components / structure of existing GOs.',
  requirements: null,
  args: {
    scene: {
      type: 'string',
      cli: '--scene',
      description: 'Name of an open scene to inspect when multiple are loaded. Default: active scene.',
    },
  },
  result: {
    type: 'object',
    fields: {
      scene: { type: 'string' },
      scenePath: { type: 'string' },
      rootObjectCount: { type: 'integer' },
      rootObjects: { type: 'array', description: 'Each entry: { name, instanceId, active, tag, layer, isStatic, components, children, childCount }.' },
    },
  },
  examples: [
    {
      title: 'Inspect the active scene',
      cli: './bin/dreamer inspect-hierarchy --wait',
      args: {},
    },
    {
      title: 'Inspect a specific open scene',
      cli: './bin/dreamer inspect-hierarchy --scene UICanvas --wait',
      args: { scene: 'UICanvas' },
    },
  ],
};
