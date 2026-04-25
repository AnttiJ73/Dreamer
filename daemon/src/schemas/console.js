'use strict';

module.exports = {
  kind: 'console',
  summary: 'Read recent Unity console entries (Debug.Log / Warning / Error, including stack traces). CLI verb: `console`. Use this when investigating why something failed — Unity errors land here even when the command itself "succeeded". This is a GET against the daemon, no --wait needed.',
  requirements: null,
  args: {
    count: {
      type: 'integer',
      cli: '--count',
      description: 'Max entries to return (newest first). Default 50, max 200.',
    },
  },
  result: {
    type: 'object',
    fields: {
      entries: { type: 'array', description: 'Each entry: { type: "Log"|"Warning"|"Error"|"Exception", message, stackTrace, timestamp }.' },
      total: { type: 'integer' },
    },
  },
  examples: [
    {
      title: 'Last 50 console entries',
      cli: './bin/dreamer console',
      args: {},
    },
    {
      title: 'Last 20 entries',
      cli: './bin/dreamer console --count 20',
      args: { count: 20 },
    },
  ],
};
