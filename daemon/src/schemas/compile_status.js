'use strict';

module.exports = {
  kind: 'compile_status',
  summary: 'Read Unity\'s current compile state: synthesized status, errors, last clean compile timestamp, asset-watcher dirty flag. CLI verb: `compile-status`. READ THE SYNTHESIZED `status` FIELD, not raw `errors`/`lastSuccess`/`compiling` — see `help conventions` → compilation. This is a GET against the daemon, not a queued Unity command — no --wait needed.',
  requirements: null,
  args: {},
  result: {
    type: 'object',
    fields: {
      status: { type: 'string', description: 'One of: ok | idle | stale | errors | compiling | unknown | disconnected.' },
      ready: { type: 'boolean', description: 'True iff status is ok or idle (compile-gated commands can proceed).' },
      summary: { type: 'string', description: 'Human-readable one-liner. Trust this — don\'t derive your own verdict.' },
      compiling: { type: 'boolean' },
      errors: { type: 'array', description: 'Compile-error strings (file/line/message).' },
      lastSuccess: { type: 'string', description: 'ISO timestamp of the last clean compile observed.' },
      assetsDirtySinceCompile: { type: 'boolean', description: 'True if the asset watcher has seen .cs changes since the last clean compile.' },
    },
  },
  examples: [
    {
      title: 'Check compile state',
      cli: './bin/dreamer compile-status',
      args: {},
    },
  ],
};
