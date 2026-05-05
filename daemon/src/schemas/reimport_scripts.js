'use strict';

module.exports = {
  kind: 'reimport_scripts',
  summary: 'Force-reimport every .cs file under a path, regardless of current importer classification. CLI verb: `reimport-script` (single file) or `reimport-scripts` (folder). Use when refresh-assets\'s auto-heal didn\'t recover a stuck script (one that\'s on disk but isn\'t in Assembly-CSharp.dll).',
  requirements: null,
  args: {
    path: {
      type: 'string',
      required: true,
      cli: '--path',
      description: 'A .cs file path, or a folder containing .cs files. May be under Assets/ or Packages/.',
    },
    recursive: {
      type: 'boolean',
      cli: '--non-recursive',
      description: 'When false (i.e. --non-recursive given), only directly-listed files in the folder are reimported. Default true.',
    },
  },
  result: {
    type: 'object',
    fields: {
      healed: { type: 'integer' },
      reimported: { type: 'array' },
      misclassified: { type: 'array' },
    },
  },
  examples: [
    {
      title: 'Reimport one stuck script',
      cli: './bin/dreamer reimport-script --path Assets/Foo.cs --wait',
      args: { path: 'Assets/Foo.cs' },
    },
    {
      title: 'Reimport every script under a folder',
      cli: './bin/dreamer reimport-scripts --path Assets/Scripts --wait',
      args: { path: 'Assets/Scripts' },
    },
  ],
};
