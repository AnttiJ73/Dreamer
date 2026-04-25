'use strict';

/**
 * Tiny schema validator used by the command schema layer.
 *
 * Not full JSON Schema — our schemas are narrow and self-contained, so a
 * handful of rules covers every command. See daemon/src/schemas/ for the
 * schema shape this validator expects:
 *
 *   {
 *     args: {
 *       <name>: { type, required?, enum?, description? }
 *     },
 *     constraints?: [
 *       { rule: 'exactlyOne', fields: [...] },
 *       { rule: 'atLeastOne', fields: [...] }
 *     ]
 *   }
 *
 * Supported types: 'string', 'number', 'integer', 'boolean', 'object', 'array', 'any'.
 *
 * Returns { valid: boolean, errors: string[] }.
 */

const KNOWN_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'object', 'array', 'any']);

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number' && Number.isInteger(value)) return 'integer';
  return typeof value;
}

function validate(schema, args) {
  const errors = [];
  const input = args && typeof args === 'object' && !Array.isArray(args) ? args : {};

  // Per-arg type and required-ness
  const spec = schema.args || {};
  for (const [name, field] of Object.entries(spec)) {
    const value = input[name];
    const missing = value === undefined || value === null;

    if (missing) {
      if (field.required) errors.push(`Missing required arg: '${name}'`);
      continue;
    }

    if (field.type && field.type !== 'any') {
      if (!KNOWN_TYPES.has(field.type)) {
        errors.push(`Schema bug: unknown type '${field.type}' on arg '${name}'`);
      } else {
        const actual = typeOf(value);
        const expected = field.type;
        // 'number' accepts both integers and floats; 'integer' requires exact int.
        const ok = expected === actual
          || (expected === 'number' && actual === 'integer');
        if (!ok) {
          errors.push(`arg '${name}' must be ${expected}, got ${actual}`);
        }
      }
    }

    if (field.enum && Array.isArray(field.enum) && !field.enum.includes(value)) {
      errors.push(`arg '${name}' must be one of [${field.enum.join(', ')}]; got ${JSON.stringify(value)}`);
    }
  }

  // Constraints across multiple args
  for (const constraint of schema.constraints || []) {
    if (constraint.rule === 'exactlyOne') {
      const present = constraint.fields.filter((f) => input[f] !== undefined && input[f] !== null);
      if (present.length === 0) {
        errors.push(`Exactly one of [${constraint.fields.join(', ')}] must be provided`);
      } else if (present.length > 1) {
        errors.push(`Only one of [${constraint.fields.join(', ')}] may be provided; got [${present.join(', ')}]`);
      }
    } else if (constraint.rule === 'atLeastOne') {
      const present = constraint.fields.filter((f) => input[f] !== undefined && input[f] !== null);
      if (present.length === 0) {
        errors.push(`At least one of [${constraint.fields.join(', ')}] must be provided`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

module.exports = { validate };
