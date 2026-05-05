'use strict';

module.exports = {
  kind: 'refresh_assets',
  summary: 'Force AssetDatabase.Refresh + auto-heal misclassified .cs files. CLI verb: `refresh-assets`. Usually NOT needed manually — the CLI auto-prepends this before compile-gated commands when the asset watcher has seen .cs changes. Call it explicitly if you wrote a script externally and have no follow-up command, or if --no-refresh suppressed the auto path.',
  requirements: null,
  args: {
    changedFiles: {
      type: 'array',
      description: 'Optional: forward-slash "Assets/..." paths the caller wants force-reimported. Internal — populated by the auto-refresh path from the asset watcher\'s tracked changes.',
    },
  },
  result: {
    type: 'object',
    fields: {
      refreshed: { type: 'boolean' },
      checked: { type: 'integer', description: 'Number of .cs files Unity\'s import classification was checked for.' },
      reimportedCount: { type: 'integer' },
      reimported: { type: 'array', description: 'Paths Unity reclassified to MonoScript on a force-reimport (the auto-heal path).' },
      misclassifiedCount: { type: 'integer' },
      misclassified: { type: 'array', description: 'Paths still stuck after force-reimport. Usually a syntax error preventing parse, or a filename/classname mismatch.' },
    },
  },
  examples: [
    {
      title: 'Manual refresh',
      cli: './bin/dreamer refresh-assets --wait',
      args: {},
    },
  ],
};
