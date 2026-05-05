'use strict';

/**
 * Command schema registry.
 *
 * Each .js file (other than this one) in this directory exports a schema
 * object describing one command kind: its args (type/required/enum), any
 * cross-field constraints, the result shape, and examples. Schemas are
 * loaded at module-require time and exposed through this registry.
 *
 * Consumers:
 *   - handlers/commands.js — validate incoming args before queuing
 *   - CLI `dreamer help <kind>` — render docs
 *   - future: regenerate the skill file from schemas instead of hand-writing
 *
 * Adding a new command: drop a file here named <kind>.js exporting at
 * minimum `{ kind: '<kind>', summary, args, result }`.
 */

const fs = require('fs');
const path = require('path');

const SCHEMAS = {};
const { conventions } = require('./_common');

for (const filename of fs.readdirSync(__dirname)) {
  if (filename === 'index.js') continue;
  // Files prefixed with '_' are shared modules (e.g. _common.js), not schemas.
  if (filename.startsWith('_')) continue;
  if (!filename.endsWith('.js')) continue;
  try {
    const schema = require(path.join(__dirname, filename));
    if (!schema || !schema.kind) continue;
    SCHEMAS[schema.kind] = schema;
  } catch (err) {
    // Don't let a malformed schema brick the daemon — just log via stderr.
    // (log.js would introduce a circular require.)
    process.stderr.write(`[Dreamer] schemas: failed to load ${filename}: ${err.message}\n`);
  }
}

module.exports = {
  /** Return the schema for `kind`, or null. */
  get(kind) {
    return SCHEMAS[kind] || null;
  },
  /** Return a shallow copy of the registry. */
  all() {
    return { ...SCHEMAS };
  },
  /** List all kinds that have a schema. */
  list() {
    return Object.keys(SCHEMAS).sort();
  },
  /** True if this kind has a schema. */
  has(kind) {
    return kind in SCHEMAS;
  },
  /** The cross-cutting conventions block (rendered by `help conventions`). */
  conventions,
};
