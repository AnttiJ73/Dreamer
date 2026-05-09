'use strict';

// Resolve a MonoScript GUID to its class name + namespace. Strategy:
//   1. Asset index lookup: GUID → "Assets/Scripts/Foo.cs".
//   2. Read the .cs file, find the most likely public class declaration.
//   3. Cache result keyed by GUID + mtime.
//
// Heuristic. If a file declares multiple classes the first non-abstract,
// non-static class wins (matches Unity's "filename = class name" convention
// in 99% of cases). If parsing fails, falls back to the filename.

const fs = require('fs');
const path = require('path');
const { entryByGuid, loadIndex } = require('./asset-index');

const cache = new Map(); // guid → { name, fullName, mtime }
let cacheLoaded = false;

function resolveScript(guid) {
  if (!guid) return null;
  const lc = guid.toLowerCase();
  let entry = entryByGuid(lc);
  if (!entry && !cacheLoaded) {
    // Lazy: extend the index with PackageCache so built-in MonoBehaviour
    // scripts (CanvasScaler, etc.) resolve.
    loadIndex({ includeCache: true });
    cacheLoaded = true;
    entry = entryByGuid(lc);
  }
  if (!entry) return null;
  if (!entry.path.endsWith('.cs')) {
    return { name: path.basename(entry.path, entry.ext), fullName: null, path: entry.path };
  }
  const stamped = cache.get(lc);
  if (stamped && stamped.mtime === entry.assetMtime) {
    return { name: stamped.name, fullName: stamped.fullName, path: entry.path };
  }
  const fileName = path.basename(entry.path, '.cs');
  let className = fileName;
  let namespace = null;
  try {
    const root = path.resolve(__dirname, '..', '..', '..');
    const text = fs.readFileSync(path.join(root, entry.path), 'utf8');
    const found = pickClass(text, fileName);
    if (found) {
      className = found.name;
      namespace = found.namespace;
    }
  } catch { /* fall through */ }

  const fullName = namespace ? `${namespace}.${className}` : className;
  const result = { name: className, fullName, path: entry.path, mtime: entry.assetMtime };
  cache.set(lc, result);
  return result;
}

// Tiny C# scanner — strips comments + strings, then scans for `namespace X {`
// and `class Y` / `struct Y`. Prefers a class whose name matches the filename
// (Unity convention).
function pickClass(text, preferredName) {
  const stripped = stripCommentsAndStrings(text);
  // Track namespace stack via simple brace counting after `namespace X {`.
  const nsStack = [];
  let depth = 0;
  let nsLastDepth = [];

  const candidates = [];
  const re = /\b(?:namespace|class|struct|interface)\s+([A-Za-z_][\w.]*)/g;

  // Walk the text in order, tracking braces between matches.
  let lastIdx = 0;
  let m;
  while ((m = re.exec(stripped)) !== null) {
    // Update brace depth from lastIdx to m.index.
    for (let i = lastIdx; i < m.index; i++) {
      const ch = stripped[i];
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        while (nsLastDepth.length && nsLastDepth[nsLastDepth.length - 1] > depth) {
          nsLastDepth.pop();
          nsStack.pop();
        }
      }
    }
    lastIdx = m.index;

    const kind = stripped.slice(m.index, m.index + 9);
    const name = m[1];
    // Skip nested class names with `.` — namespace declarations like `Foo.Bar` don't matter.
    if (kind.startsWith('namespace')) {
      // Push namespace onto stack at the brace level we'll enter next.
      nsStack.push(name);
      nsLastDepth.push(depth);
    } else if (kind.startsWith('class') || kind.startsWith('struct')) {
      candidates.push({ name, namespace: nsStack.join('.') || null });
    }
  }

  if (candidates.length === 0) return null;
  // Prefer name === filename (the strict Unity convention).
  const exact = candidates.find(c => c.name === preferredName);
  if (exact) return exact;
  // Otherwise the first candidate.
  return candidates[0];
}

function stripCommentsAndStrings(text) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const n = text[i + 1];
    if (c === '/' && n === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && n === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i += 2;
      out += ' ';
      continue;
    }
    if (c === '"') {
      i++;
      while (i < text.length && text[i] !== '"') {
        if (text[i] === '\\') i += 2;
        else i++;
      }
      i++;
      out += '""';
      continue;
    }
    if (c === '@' && n === '"') {
      i += 2;
      while (i < text.length) {
        if (text[i] === '"' && text[i + 1] === '"') { i += 2; continue; }
        if (text[i] === '"') break;
        i++;
      }
      i++;
      out += '""';
      continue;
    }
    if (c === '$' && n === '"') {
      i += 2;
      let depth = 0;
      while (i < text.length) {
        if (text[i] === '{' && text[i + 1] !== '{') depth++;
        else if (text[i] === '}' && depth > 0) depth--;
        else if (text[i] === '"' && depth === 0) break;
        i++;
      }
      i++;
      out += '""';
      continue;
    }
    if (c === "'") {
      i++;
      while (i < text.length && text[i] !== "'") {
        if (text[i] === '\\') i += 2;
        else i++;
      }
      i++;
      out += "''";
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

module.exports = { resolveScript };
