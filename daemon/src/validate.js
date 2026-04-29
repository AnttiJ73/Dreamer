'use strict';

// Tiny schema validator (not full JSON Schema). Schema shape:
//   { args: { <name>: { type, required?, enum?, description? } },
//     constraints?: [ { rule: 'exactlyOne'|'atLeastOne', fields: [...] } ] }
// Types: string, number, integer, boolean, object, array, any. Returns { valid, errors }.

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

  const spec = schema.args || {};
  for (const [name, field] of Object.entries(spec)) {
    const value = input[name];
    const missing = value === undefined || value === null;

    if (missing) {
      if (field.required) errors.push(`Missing required arg: '${name}'`);
      continue;
    }

    if (field.type && field.type !== 'any') {
      // Union type: ['string', 'number'] etc. Accepts the value if any listed type matches.
      const types = Array.isArray(field.type) ? field.type : [field.type];
      const unknown = types.find(t => t !== 'any' && !KNOWN_TYPES.has(t));
      if (unknown) {
        errors.push(`Schema bug: unknown type '${unknown}' on arg '${name}'`);
      } else if (!types.includes('any')) {
        const actual = typeOf(value);
        const ok = types.some(expected =>
          expected === actual || (expected === 'number' && actual === 'integer'));
        if (!ok) {
          errors.push(`arg '${name}' must be ${types.join(' or ')}, got ${actual}`);
        }
      }
    }

    if (field.enum && Array.isArray(field.enum) && !field.enum.includes(value)) {
      errors.push(`arg '${name}' must be one of [${field.enum.join(', ')}]; got ${JSON.stringify(value)}`);
    }
  }

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
