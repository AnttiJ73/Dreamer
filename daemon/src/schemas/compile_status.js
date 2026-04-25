'use strict';

module.exports = {
  kind: 'compile_status',
  summary: 'Read Unity\'s current compile state: synthesized status, errors, last clean compile timestamp, asset-watcher dirty flag. CLI verb: `compile-status`. READ THE SYNTHESIZED `status` FIELD, not raw `errors`/`lastSuccess`/`compiling` — see `help conventions` → compilation. This is a GET against the daemon, not a queued Unity command — no --wait needed.',
  requirements: null,
  args: {},
  result: {
    type: 'object',
    fields: {
      status: { type: 'string', description: 'One of: ok | idle | stale | errors | compiling | unknown | disconnected. THIS IS THE FIELD TO READ.' },
      ready: { type: 'boolean', description: 'True iff status is ok or idle (compile-gated commands can proceed).' },
      summary: { type: 'string', description: 'Human-readable one-liner. Trust this — don\'t derive your own verdict.' },
      compiling: { type: 'boolean' },
      errors: { type: 'array', description: 'Compile-error strings (file/line/message).' },
      lastSuccess: { type: 'string', description: 'ISO timestamp of the last clean compile observed.' },
      assetsDirtySinceCompile: { type: 'boolean', description: 'True if the asset watcher has seen .cs changes since the last clean compile.' },
    },
  },
  statusValues: [
    { value: 'ok',           ready: true,  meaning: 'Compile is clean. Proceed.' },
    { value: 'idle',         ready: true,  meaning: 'Connected, no errors, but no compile observed yet this daemon session. If you just wrote .cs, run refresh-assets --wait. Otherwise proceed.' },
    { value: 'stale',        ready: false, meaning: 'Assets edited AFTER the last clean compile. errors:[] is lying. Run refresh-assets --wait (+ focus-unity on Windows).' },
    { value: 'errors',       ready: false, meaning: 'Real compile errors. summary lists the first three. Fix the code.' },
    { value: 'compiling',    ready: false, meaning: 'Unity is compiling right now. Wait briefly and retry.' },
    { value: 'unknown',      ready: false, meaning: 'Bridge connected but hasn\'t reported compile state yet. Wait briefly.' },
    { value: 'disconnected', ready: false, meaning: 'Unity bridge isn\'t connected. Start/focus Unity.' },
  ],
  examples: [
    {
      title: 'Check compile state before a compile-gated command',
      cli: './bin/dreamer compile-status',
      args: {},
    },
    {
      title: 'After writing a .cs file externally',
      cli: '# Sequence: write file → refresh → check\n./bin/dreamer refresh-assets --wait\n./bin/dreamer compile-status',
      args: {},
    },
  ],
  pitfalls: [
    'STOPPING RULE: if `refresh-assets --wait` + `focus-unity` twice in a row hasn\'t changed `status`, STOP retrying. Something structural is wrong (Auto Refresh disabled, file stuck on wrong importer, syntax error preventing parse). Ask the user — DO NOT loop indefinitely.',
    'DO NOT derive your own verdict from raw `errors:[]` / `lastSuccess` / `compiling`. Read the `status` field. `idle` and `stale` both have empty `errors[]` but mean very different things.',
    '`status: idle` means "connected, no errors cached, but no compile observed THIS daemon session." If you just wrote a .cs, errors:[] reflects pre-edit state — run refresh-assets first.',
    '`status: stale` means the asset watcher saw .cs changes after the last clean compile. The cached errors[] reflects the OLD code, not the new. Trust `summary`, not `errors`.',
    '`compile-status` is a GET against the daemon — no `--wait` flag needed (and unsupported). It returns immediately with the current state.',
    'Unity\'s main thread STOPS when unfocused on Windows. If `compile-status` looks frozen (timestamps not advancing), Unity isn\'t ticking — run `focus-unity`.',
  ],
};
