'use strict';

module.exports = {
  kind: 'inspect_project_settings',
  summary:
    "Overview of Unity Project Settings. CLI verb: `inspect-project-settings`. " +
    "With no `--file`: returns layers (32), tags, sorting layers, 3D + 2D physics summary " +
    "(gravity + disabled-collision pairs), and the list of every `.asset` in `ProjectSettings/` " +
    "(those names are valid `--file` arguments to set-project-setting / inspect-project-setting). " +
    "With `--file X`: returns the top-level field listing for that one file (use this to discover " +
    "property paths before calling set-project-setting).",
  requirements: null,
  args: {
    file: {
      type: 'string',
      cli: '--file',
      description:
        'Optional. Short name (`TagManager`) or filename (`TagManager.asset`) or full path (`ProjectSettings/TagManager.asset`). When set, returns a per-field listing for that one file.',
    },
  },
  result: {
    type: 'object',
    fields: {
      layers: { type: 'array', description: '32 layers, each `{index, name, builtin}`.' },
      tags: { type: 'array' },
      sortingLayers: { type: 'array' },
      physics3D: { type: 'object', description: '`gravity`, `defaultContactOffset`, solver iterations, `disabledCollisionPairs[]`.' },
      physics2D: { type: 'object' },
      files: { type: 'array', description: 'Every `.asset` in `ProjectSettings/`. Pass any of these names to set-project-setting / inspect-project-setting.' },
    },
  },
  examples: [
    {
      title: 'Project-wide overview',
      cli: './bin/dreamer inspect-project-settings',
      args: {},
    },
    {
      title: 'List all top-level fields on TagManager',
      cli: './bin/dreamer inspect-project-settings --file TagManager',
      args: { file: 'TagManager' },
    },
  ],
};
