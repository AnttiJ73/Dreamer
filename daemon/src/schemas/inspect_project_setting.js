'use strict';

module.exports = {
  kind: 'inspect_project_setting',
  summary:
    "Inspect a single ProjectSettings file or a sub-tree within it. CLI verb: `inspect-project-setting`. " +
    "Without `--property`: returns the same per-field listing as `inspect-project-settings --file X`. " +
    "With `--property`: returns the resolved value tree at that path (depth-limited).",
  requirements: null,
  args: {
    file: {
      type: 'string',
      required: true,
      cli: '--file',
      description: 'Short name (`TagManager`), filename, or `ProjectSettings/X.asset` form.',
    },
    propertyPath: {
      type: 'string',
      cli: '--property',
      description: 'Optional. Serialized property path (e.g. `layers`, `m_LayerCollisionMatrix`, `m_SortingLayers[0]`). When omitted, returns top-level field listing.',
    },
    depth: { type: 'integer', cli: '--depth', description: 'Recursion depth for nested structs/arrays. Default 3.' },
  },
  result: {
    type: 'object',
    fields: {
      file: { type: 'string' },
      typeName: { type: 'string' },
      fields: { type: 'array', description: 'When no propertyPath: each field summarized as {path, type, displayName, preview}.' },
      value: { type: 'any', description: 'When propertyPath was provided: the value tree at that path.' },
    },
  },
  examples: [
    {
      title: 'List all top-level fields on DynamicsManager',
      cli: './bin/dreamer inspect-project-setting --file DynamicsManager',
      args: { file: 'DynamicsManager' },
    },
    {
      title: 'Read sorting layers detail',
      cli: './bin/dreamer inspect-project-setting --file TagManager --property m_SortingLayers',
      args: { file: 'TagManager', propertyPath: 'm_SortingLayers' },
    },
  ],
};
