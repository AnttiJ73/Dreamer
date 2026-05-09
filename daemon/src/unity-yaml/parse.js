'use strict';

// Minimal Unity-flavored YAML parser. Targets the slice of YAML 1.1 that
// Unity actually emits in .prefab / .unity / .asset / .mat / .anim / .controller
// files: multi-document, block & flow scalars, block & flow sequences/maps,
// `{fileID, guid, type}` cross-refs, and `!u!CLASS &FILEID` document headers.
//
// Returns: [{ classId, fileId, stripped, body }, …]   one entry per `--- !u!N &id` doc.
// `body` is a plain JS value (object | array | scalar) — exactly what you'd
// expect from JSON.parse on an equivalent JSON shape. The first key of `body`
// is the class type name (e.g. "GameObject", "Transform", "ParticleSystem").
//
// Internally uses an index-passing recursive parser so same-indent sequences
// (a YAML quirk Unity uses heavily — `key:\n- item\n- item` with the dashes
// at the SAME indent as the key) are handled cleanly.

function parseUnityYaml(text) {
  if (typeof text !== 'string') throw new TypeError('parseUnityYaml: input must be a string');

  const lines = text.split(/\r\n|\r|\n/);
  const docs = [];
  let i = 0;

  // Skip directives + initial blank lines.
  while (i < lines.length) {
    const t = lines[i].trim();
    if (t === '' || t.startsWith('%') || t.startsWith('#')) { i++; continue; }
    break;
  }

  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();
    if (t === '' || t.startsWith('#')) { i++; continue; }
    if (!line.startsWith('---')) {
      throw new Error(`Unity YAML: expected '--- !u!CLASS &FID' at line ${i + 1}, got: ${line}`);
    }
    const head = parseDocHeader(line, i + 1);
    i++;
    // Find next doc boundary.
    let bodyEnd = i;
    while (bodyEnd < lines.length && !lines[bodyEnd].startsWith('---')) bodyEnd++;
    const result = parseValue(lines, i, 0);
    docs.push({ classId: head.classId, fileId: head.fileId, stripped: head.stripped, body: result.value });
    i = Math.max(result.nextIndex, bodyEnd);
  }

  return docs;
}

function parseDocHeader(line, lineNum) {
  const m = line.match(/^---\s+!u!(-?\d+)\s+&(-?\d+)(\s+stripped)?\s*$/);
  if (!m) throw new Error(`Unity YAML: malformed doc header at line ${lineNum}: ${line}`);
  return {
    classId: parseInt(m[1], 10),
    fileId: m[2],
    stripped: !!m[3],
  };
}

// Parse a value (mapping / sequence / scalar) starting at `index`, where
// content at `>= minIndent` belongs to this value. Skips leading blanks.
// Returns { value, nextIndex } — nextIndex is the first line NOT consumed.
function parseValue(lines, index, minIndent) {
  // Skip blanks/comments.
  let i = index;
  while (i < lines.length) {
    const t = lines[i].trim();
    if (t === '' || t.startsWith('#')) { i++; continue; }
    if (lines[i].startsWith('---')) return { value: null, nextIndex: i };
    break;
  }
  if (i >= lines.length) return { value: null, nextIndex: i };

  const line = lines[i];
  const indent = leadingSpaces(line);
  if (indent < minIndent) return { value: null, nextIndex: i };

  const content = line.slice(indent);

  // Block sequence?
  if (content.startsWith('- ') || content === '-') {
    return parseSequence(lines, i, indent);
  }

  // Block mapping (heuristic: `key: ` or `key:\n` at top level).
  const colonIdx = findMappingColon(content);
  if (colonIdx >= 0) {
    return parseMapping(lines, i, indent);
  }

  // Plain scalar / flow.
  return { value: parseScalar(content), nextIndex: i + 1 };
}

function parseMapping(lines, startIndex, indent) {
  const map = {};
  let i = startIndex;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith('---')) break;
    const t = line.trim();
    if (t === '' || t.startsWith('#')) { i++; continue; }
    const lineIndent = leadingSpaces(line);
    if (lineIndent < indent) break;
    if (lineIndent > indent) {
      // Belongs to a previous key; should never happen if invoked correctly.
      throw new Error(`Unexpected over-indent at line ${i + 1}: "${line}"`);
    }
    const content = line.slice(indent);

    // Same-indent sequence inside a mapping ends the mapping (the sequence
    // is the value of the previous key, handled where that key was parsed).
    if (content.startsWith('- ') || content === '-') break;

    const colonIdx = findMappingColon(content);
    if (colonIdx < 0) {
      throw new Error(`Expected 'key:' at line ${i + 1}: "${line}"`);
    }
    const key = unquoteKey(content.slice(0, colonIdx).trim());
    const after = content.slice(colonIdx + 1).replace(/^\s+/, '');

    if (after === '' || after.startsWith('#')) {
      // Block value — could be at higher indent (nested mapping/sequence)
      // OR at the same indent as the key (same-indent sequence).
      const lookahead = peekNonBlank(lines, i + 1);
      if (lookahead < 0) { map[key] = null; i = i + 1; continue; }
      const peekLine = lines[lookahead];
      if (peekLine.startsWith('---')) { map[key] = null; i = lookahead; continue; }
      const peekIndent = leadingSpaces(peekLine);
      const peekContent = peekLine.slice(peekIndent);

      if (peekIndent === indent && (peekContent.startsWith('- ') || peekContent === '-')) {
        // Same-indent sequence is this key's value.
        const seq = parseSequence(lines, lookahead, indent);
        map[key] = seq.value;
        i = seq.nextIndex;
      } else if (peekIndent > indent) {
        // Nested block.
        const child = parseValue(lines, lookahead, peekIndent);
        map[key] = child.value;
        i = child.nextIndex;
      } else {
        // Below us — null.
        map[key] = null;
        i = i + 1;
      }
    } else {
      const fv = readPossiblyMultilineFlow(lines, i, after);
      map[key] = parseScalar(fv.value);
      i = fv.nextIndex;
    }
  }
  return { value: map, nextIndex: i };
}

function parseSequence(lines, startIndex, indent) {
  const arr = [];
  let i = startIndex;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith('---')) break;
    const t = line.trim();
    if (t === '' || t.startsWith('#')) { i++; continue; }
    const lineIndent = leadingSpaces(line);
    if (lineIndent < indent) break;
    if (lineIndent > indent) throw new Error(`Unexpected over-indent in sequence at line ${i + 1}: "${line}"`);
    const content = line.slice(indent);
    if (!(content.startsWith('- ') || content === '-')) break;

    const inline = content === '-' ? '' : content.slice(2);

    if (inline === '' || inline.startsWith('#')) {
      // Multi-line item; child block must be > indent.
      const lookahead = peekNonBlank(lines, i + 1);
      if (lookahead < 0) { arr.push(null); i = i + 1; continue; }
      const peekLine = lines[lookahead];
      if (peekLine.startsWith('---')) { arr.push(null); i = lookahead; continue; }
      const peekIndent = leadingSpaces(peekLine);
      if (peekIndent <= indent) { arr.push(null); i = i + 1; continue; }
      const child = parseValue(lines, lookahead, peekIndent);
      arr.push(child.value);
      i = child.nextIndex;
      continue;
    }

    // Inline item content. Could be:
    //   1. Plain scalar / flow value
    //   2. Mapping start ("- key: value" + possibly more keys at indent+2)
    const inlineColon = findMappingColon(inline);
    if (inlineColon < 0) {
      const fv = readPossiblyMultilineFlow(lines, i, inline);
      arr.push(parseScalar(fv.value));
      i = fv.nextIndex;
      continue;
    }

    // Compound mapping item.
    const key = unquoteKey(inline.slice(0, inlineColon).trim());
    const after = inline.slice(inlineColon + 1).replace(/^\s+/, '');
    const itemIndent = indent + 2;
    const item = {};

    if (after === '' || after.startsWith('#')) {
      const lookahead = peekNonBlank(lines, i + 1);
      if (lookahead < 0 || lines[lookahead].startsWith('---')) {
        item[key] = null;
        i = i + 1;
      } else {
        const peekIndent = leadingSpaces(lines[lookahead]);
        if (peekIndent === itemIndent && (lines[lookahead].slice(itemIndent).startsWith('- ') || lines[lookahead].slice(itemIndent) === '-')) {
          // Same-indent sequence as value.
          const seq = parseSequence(lines, lookahead, itemIndent);
          item[key] = seq.value;
          i = seq.nextIndex;
        } else if (peekIndent > itemIndent) {
          const child = parseValue(lines, lookahead, peekIndent);
          item[key] = child.value;
          i = child.nextIndex;
        } else {
          item[key] = null;
          i = i + 1;
        }
      }
    } else {
      const fv = readPossiblyMultilineFlow(lines, i, after);
      item[key] = parseScalar(fv.value);
      i = fv.nextIndex;
    }

    // Slurp additional keys at itemIndent for this same item.
    while (i < lines.length) {
      const cl = lines[i];
      if (cl.startsWith('---')) break;
      const tc = cl.trim();
      if (tc === '' || tc.startsWith('#')) { i++; continue; }
      const ci = leadingSpaces(cl);
      if (ci !== itemIndent) break;
      const inner = cl.slice(itemIndent);
      if (inner.startsWith('- ') || inner === '-') break;
      const cIdx = findMappingColon(inner);
      if (cIdx < 0) break;
      const k2 = unquoteKey(inner.slice(0, cIdx).trim());
      const v2 = inner.slice(cIdx + 1).replace(/^\s+/, '');
      if (v2 === '' || v2.startsWith('#')) {
        const lookahead = peekNonBlank(lines, i + 1);
        if (lookahead < 0 || lines[lookahead].startsWith('---')) {
          item[k2] = null;
          i = i + 1;
        } else {
          const peekIndent = leadingSpaces(lines[lookahead]);
          const peekContent = lines[lookahead].slice(peekIndent);
          if (peekIndent === itemIndent && (peekContent.startsWith('- ') || peekContent === '-')) {
            const seq = parseSequence(lines, lookahead, itemIndent);
            item[k2] = seq.value;
            i = seq.nextIndex;
          } else if (peekIndent > itemIndent) {
            const child = parseValue(lines, lookahead, peekIndent);
            item[k2] = child.value;
            i = child.nextIndex;
          } else {
            item[k2] = null;
            i = i + 1;
          }
        }
      } else {
        const fv = readPossiblyMultilineFlow(lines, i, v2);
        item[k2] = parseScalar(fv.value);
        i = fv.nextIndex;
      }
    }
    arr.push(item);
  }
  return { value: arr, nextIndex: i };
}

// Two YAML wrap patterns Unity actually emits:
//
//   1. Multi-line flow value:
//        debugReplacementPS: {fileID: 4800000, guid: cf852408..., type: 3,
//          extra: ...}
//
//   2. Multi-line plain-scalar fold (continuation at deeper indent):
//        m_text: Manage your equipped items, weapons, and accessories. Drag from inventory
//            to equip.
//
// Both join continuation lines with a single space. Quoted scalars don't fold
// in this codebase's inputs (Unity emits them on one line), so we don't try.
function readPossiblyMultilineFlow(lines, currentIndex, inline) {
  // Case 1: flow value that may span lines.
  if (inline.startsWith('{') || inline.startsWith('[')) {
    if (isFlowBalanced(inline)) {
      return { value: inline, nextIndex: currentIndex + 1 };
    }
    const parts = [inline];
    let i = currentIndex + 1;
    while (i < lines.length) {
      const cl = lines[i];
      if (cl.startsWith('---')) break;
      parts.push(cl.trim());
      i++;
      if (isFlowBalanced(parts.join(' '))) break;
    }
    return { value: parts.join(' '), nextIndex: i };
  }
  // Quoted scalar — single line in our inputs.
  if (inline.startsWith('"') || inline.startsWith("'")) {
    return { value: inline, nextIndex: currentIndex + 1 };
  }
  // Case 2: plain-scalar continuation. Look for following lines that are at
  // strictly deeper indent than the current line AND don't themselves look
  // like a mapping key or sequence item. Glue them together with spaces.
  const currentIndent = leadingSpaces(lines[currentIndex]);
  const parts = [inline];
  let i = currentIndex + 1;
  while (i < lines.length) {
    const cl = lines[i];
    if (cl.startsWith('---')) break;
    const tc = cl.trim();
    if (tc === '' || tc.startsWith('#')) { i++; continue; }
    const ci = leadingSpaces(cl);
    if (ci <= currentIndent) break;
    const inner = cl.slice(ci);
    if (inner.startsWith('- ') || inner === '-') break;
    if (findMappingColon(inner) >= 0) break;
    parts.push(tc);
    i++;
  }
  if (parts.length === 1) {
    return { value: inline, nextIndex: currentIndex + 1 };
  }
  return { value: parts.join(' '), nextIndex: i };
}

function isFlowBalanced(s) {
  let depth = 0, inSingle = false, inDouble = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inDouble) { if (ch === '\\') i++; else if (ch === '"') inDouble = false; continue; }
    if (inSingle) { if (ch === "'" && s[i+1] === "'") i++; else if (ch === "'") inSingle = false; continue; }
    if (ch === '"') inDouble = true;
    else if (ch === "'") inSingle = true;
    else if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') depth--;
  }
  return depth === 0 && !inSingle && !inDouble;
}

function peekNonBlank(lines, from) {
  let i = from;
  while (i < lines.length) {
    const t = lines[i].trim();
    if (t === '' || t.startsWith('#')) { i++; continue; }
    return i;
  }
  return -1;
}

function leadingSpaces(s) {
  let n = 0;
  while (n < s.length && s.charCodeAt(n) === 0x20) n++;
  return n;
}

function findMappingColon(line) {
  let depth = 0, inSingle = false, inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inDouble) { if (ch === '\\') i++; else if (ch === '"') inDouble = false; continue; }
    if (inSingle) { if (ch === "'" && line[i+1] === "'") i++; else if (ch === "'") inSingle = false; continue; }
    if (ch === '"') { inDouble = true; continue; }
    if (ch === "'") { inSingle = true; continue; }
    if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') depth--;
    else if (ch === ':' && depth === 0) {
      const next = line[i + 1];
      if (next === undefined || next === ' ' || next === '\t') return i;
    }
  }
  return -1;
}

// YAML 1.1 double-quoted string escapes — superset of JSON. Includes \xNN
// (hex byte) and other escapes JSON doesn't support, so we can't delegate
// to JSON.parse.
function unescapeYamlDoubleQuoted(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c !== '\\') { out += c; continue; }
    const n = s[++i];
    switch (n) {
      case '0':  out += '\0'; break;
      case 'a':  out += '\x07'; break;
      case 'b':  out += '\b'; break;
      case 't':  out += '\t'; break;
      case 'n':  out += '\n'; break;
      case 'v':  out += '\x0B'; break;
      case 'f':  out += '\f'; break;
      case 'r':  out += '\r'; break;
      case 'e':  out += '\x1B'; break;
      case ' ':  out += ' '; break;
      case '"':  out += '"'; break;
      case '/':  out += '/'; break;
      case '\\': out += '\\'; break;
      case 'N':  out += ''; break;
      case '_':  out += ' '; break;
      case 'L':  out += ' '; break;
      case 'P':  out += ' '; break;
      case 'x': {
        const hex = s.slice(i + 1, i + 3);
        if (!/^[0-9a-fA-F]{2}$/.test(hex)) throw new Error(`Invalid \\x escape in: ${s}`);
        out += String.fromCharCode(parseInt(hex, 16));
        i += 2;
        break;
      }
      case 'u': {
        const hex = s.slice(i + 1, i + 5);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new Error(`Invalid \\u escape in: ${s}`);
        out += String.fromCharCode(parseInt(hex, 16));
        i += 4;
        break;
      }
      case 'U': {
        const hex = s.slice(i + 1, i + 9);
        if (!/^[0-9a-fA-F]{8}$/.test(hex)) throw new Error(`Invalid \\U escape in: ${s}`);
        out += String.fromCodePoint(parseInt(hex, 16));
        i += 8;
        break;
      }
      default:
        // Unknown — keep literal.
        out += '\\' + n;
    }
  }
  return out;
}

function unquoteKey(s) {
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) return JSON.parse(s);
  if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1).replace(/''/g, "'");
  return s;
}

function parseScalar(s) {
  if (s === '' || s === '~' || s === 'null' || s === 'Null' || s === 'NULL') return null;
  if (s === 'true' || s === 'True' || s === 'TRUE') return true;
  if (s === 'false' || s === 'False' || s === 'FALSE') return false;
  if (s.startsWith('"')) {
    let end = -1;
    for (let i = 1; i < s.length; i++) {
      if (s[i] === '\\') { i++; continue; }
      if (s[i] === '"') { end = i; break; }
    }
    if (end < 0) throw new Error(`Unterminated double-quoted string: ${s}`);
    return unescapeYamlDoubleQuoted(s.slice(1, end));
  }
  if (s.startsWith("'")) {
    let end = -1;
    for (let i = 1; i < s.length; i++) {
      if (s[i] === "'" && s[i + 1] === "'") { i++; continue; }
      if (s[i] === "'") { end = i; break; }
    }
    if (end < 0) throw new Error(`Unterminated single-quoted string: ${s}`);
    return s.slice(1, end).replace(/''/g, "'");
  }
  if (s.startsWith('{')) return parseFlowMap(s);
  if (s.startsWith('[')) return parseFlowSeq(s);
  if (/^-?\d+$/.test(s)) {
    const n = Number(s);
    if (Number.isSafeInteger(n)) return n;
    return s; // huge fileIDs as strings to preserve precision
  }
  if (/^-?(\d+\.\d*|\.\d+|\d+)(e[+-]?\d+)?$/i.test(s)) return parseFloat(s);
  if (/^\.inf$/i.test(s)) return Infinity;
  if (/^-\.inf$/i.test(s)) return -Infinity;
  if (/^\.nan$/i.test(s)) return NaN;
  return s;
}

function parseFlowMap(s) {
  if (!s.startsWith('{') || !s.endsWith('}')) throw new Error(`Invalid flow map: ${s}`);
  const inner = s.slice(1, -1).trim();
  if (inner === '') return {};
  const parts = splitFlow(inner);
  const obj = {};
  for (const part of parts) {
    const colon = findMappingColon(part);
    if (colon < 0) throw new Error(`Invalid flow-map entry: "${part}"`);
    const k = unquoteKey(part.slice(0, colon).trim());
    const v = part.slice(colon + 1).trim();
    obj[k] = parseScalar(v);
  }
  return obj;
}

function parseFlowSeq(s) {
  if (!s.startsWith('[') || !s.endsWith(']')) throw new Error(`Invalid flow sequence: ${s}`);
  const inner = s.slice(1, -1).trim();
  if (inner === '') return [];
  return splitFlow(inner).map(parseScalar);
}

function splitFlow(s) {
  const out = [];
  let depth = 0, inSingle = false, inDouble = false, last = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inDouble) { if (ch === '\\') i++; else if (ch === '"') inDouble = false; continue; }
    if (inSingle) { if (ch === "'" && s[i+1] === "'") i++; else if (ch === "'") inSingle = false; continue; }
    if (ch === '"') inDouble = true;
    else if (ch === "'") inSingle = true;
    else if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') depth--;
    else if (ch === ',' && depth === 0) {
      out.push(s.slice(last, i).trim());
      last = i + 1;
    }
  }
  const tail = s.slice(last).trim();
  if (tail) out.push(tail);
  return out;
}

module.exports = { parseUnityYaml };
