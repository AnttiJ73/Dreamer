'use strict';

module.exports = {
  kind: 'set_play_mode',
  summary:
    'Enter, exit, toggle, pause, or unpause Unity Play Mode. CLI verb: `set-play-mode`. ' +
    'Use this instead of `execute-menu-item Edit/Play` — Unity\'s ExecuteMenuItem silently ' +
    'fails for menu items with validation handlers, which includes Play/Pause. The Edit/Play ' +
    'and Edit/Pause menu paths are auto-routed to this command on the bridge side, so existing ' +
    'agent code that calls them keeps working. ' +
    'Gated by a per-machine policy: the developer is asked once on first bridge start whether ' +
    'agents may control play mode. When denied, this command returns a clear error and should ' +
    'be surfaced to the user rather than retried.',
  requirements: null,
  args: {
    state: {
      type: 'string',
      required: true,
      cli: '--state',
      enum: ['enter', 'exit', 'toggle', 'pause', 'unpause', 'toggle-pause'],
      description:
        'Target state. `enter`/`exit` are no-ops if already in that state. ' +
        '`toggle` flips play. `pause`/`unpause` set the pause flag (only meaningful in play mode). ' +
        '`toggle-pause` flips the pause flag.',
    },
  },
  result: {
    type: 'object',
    fields: {
      requestedState: { type: 'string' },
      wasPlaying: { type: 'boolean', description: 'Play state before the call.' },
      wasPaused: { type: 'boolean', description: 'Pause state before the call.' },
      playMode: { type: 'boolean', description: 'Immediate play state after the call (transitions are async — re-check status to confirm settled state).' },
      paused: { type: 'boolean' },
      note: { type: 'string' },
    },
  },
  examples: [
    {
      title: 'Exit play mode',
      cli: './bin/dreamer set-play-mode --state exit --wait',
      args: { state: 'exit' },
    },
    {
      title: 'Enter play mode',
      cli: './bin/dreamer set-play-mode --state enter --wait',
      args: { state: 'enter' },
    },
    {
      title: 'Pause the running game',
      cli: './bin/dreamer set-play-mode --state pause --wait',
      args: { state: 'pause' },
    },
  ],
  pitfalls: [
    'If the developer denied play-mode toggling at first run, every call returns "Play-mode toggling is disabled by the project owner." Surface this to the user rather than retrying.',
    'Play-mode transitions are async. The result reports the immediate state — Unity may still be transitioning when this command returns. Re-check `./bin/dreamer status` if you need the settled state.',
    'Entering play mode with compile errors is blocked by Unity itself; this command will report success but Unity refuses to start play.',
  ],
};
