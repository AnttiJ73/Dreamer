#!/usr/bin/env node
'use strict';

const { run } = require('../src/cli');

run(process.argv.slice(2)).catch((err) => {
  process.stderr.write(JSON.stringify({ error: err.message }, null, 2) + '\n');
  process.exit(1);
});
