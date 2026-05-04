'use strict';

// Schema-based command search. Lets agents (and humans) find tools by partial
// name, summary text, arg names, examples, or pitfalls instead of guessing
// exact CLI verbs. The default exploration interface — `dreamer help <X>`
// falls back here when X isn't an exact kind, so a missed lookup yields
// suggestions instead of "command not found."

const schemas = require('./schemas');

// Hand-curated CLI-verb → kind aliases (matches the VERB_ALIASES map in cli.js).
// Indexed alongside the auto-generated kebab forms so 'inspect' finds 'inspect_asset', etc.
const VERB_ALIASES = {
  'inspect': 'inspect_asset',
  'inspect-many': 'inspect_assets',
  'rename': 'rename_gameobject',
  'reparent': 'reparent_gameobject',
};

/** Build per-kind searchable corpus once per CLI invocation. */
function buildCorpus() {
  const all = schemas.all();
  const aliasByKind = {};
  for (const [verb, kind] of Object.entries(VERB_ALIASES)) {
    if (!aliasByKind[kind]) aliasByKind[kind] = [];
    aliasByKind[kind].push(verb);
  }

  const corpus = [];
  for (const [kind, schema] of Object.entries(all)) {
    const cliVerb = kind.replace(/_/g, '-');
    const names = [kind, cliVerb, ...(aliasByKind[kind] || [])];
    const examples = (schema.examples || [])
      .map(e => e.cli || '')
      .filter(Boolean);
    const argNames = Object.keys(schema.args || {})
      .concat((schema.args || {}) && Object.values(schema.args || {}).map(a => a && a.cli).filter(Boolean));
    const argDescs = Object.values(schema.args || {})
      .map(a => (a && a.description) || '')
      .join(' ');
    corpus.push({
      kind,
      cliVerb,
      names,
      summary: schema.summary || '',
      examples,
      argNames: argNames.join(' '),
      argDescs,
      pitfalls: (schema.pitfalls || []).join(' '),
    });
  }
  return corpus;
}

function levenshtein(a, b) {
  if (a === b) return 0;
  const al = a.length, bl = b.length;
  if (al === 0) return bl;
  if (bl === 0) return al;
  const dp = new Array(bl + 1);
  for (let j = 0; j <= bl; j++) dp[j] = j;
  for (let i = 1; i <= al; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= bl; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j - 1], dp[j]);
      prev = tmp;
    }
  }
  return dp[bl];
}

function tokenize(text) {
  return String(text).toLowerCase().split(/[\s\-_,;:.()/\\]+/).filter(Boolean);
}

// Hand-curated synonym map for broad-pass matching. Keys + values are normalized
// lowercase tokens; expansion is symmetric (copy↔duplicate↔clone). Kept conservative
// to avoid false-positive noise — a token like "set" deliberately doesn't expand to
// every modify-style verb because it'd flood results.
const SYNONYMS = {
  copy: ['duplicate', 'clone'],
  duplicate: ['copy', 'clone'],
  clone: ['copy', 'duplicate'],
  remove: ['delete'],
  delete: ['remove'],
  edit: ['modify', 'update'],
  modify: ['edit', 'update'],
  update: ['edit', 'modify'],
  show: ['inspect', 'preview', 'view'],
  view: ['inspect', 'preview', 'show'],
  preview: ['inspect', 'view', 'show', 'screenshot'],
  inspect: ['show', 'preview', 'view', 'examine', 'read'],
  examine: ['inspect'],
  read: ['inspect', 'get'],
  find: ['search', 'list'],
  search: ['find'],
  list: ['find', 'show'],
  add: ['create', 'new'],
  create: ['add', 'new', 'make'],
  new: ['create', 'add'],
  make: ['create'],
  rename: ['name'],
  move: ['reparent'],
  parent: ['reparent'],
  reparent: ['parent', 'move'],
  picture: ['screenshot', 'image', 'preview'],
  image: ['screenshot', 'preview', 'picture'],
  screenshot: ['preview', 'image', 'picture', 'shot', 'capture'],
  shot: ['screenshot'],
  capture: ['screenshot'],
  configure: ['config', 'set'],
  config: ['configure'],
  ppu: ['pixelsperunit'],
  layer: ['sortinglayer'],
  tag: ['tags'],
  collide: ['collision'],
  collision: ['collide'],
  size: ['scale', 'resize', 'dimension'],
  resize: ['size', 'scale'],
  pivot: ['anchor'],
  anchor: ['pivot'],
  cut: ['slice', 'split'],
  split: ['slice', 'cut'],
  slice: ['cut', 'split'],
};

function expandTokens(tokens) {
  const out = [];
  for (const t of tokens) {
    const variants = new Set([t]);
    if (SYNONYMS[t]) for (const s of SYNONYMS[t]) variants.add(s);
    // Crude stemming: strip common English inflections so "duplicates" matches "duplicate".
    const stem = t.replace(/(?:ies|es|ing|ed|er|s)$/, '');
    if (stem.length >= 3 && stem !== t) variants.add(stem);
    out.push(Array.from(variants));
  }
  return out;
}

// Character-trigram set; used in broad pass for typo / partial-name tolerance beyond
// Levenshtein's strict edit-distance bound.
function trigrams(s) {
  const padded = `  ${s.toLowerCase()}  `;
  const set = new Set();
  for (let i = 0; i + 3 <= padded.length; i++) set.add(padded.substr(i, 3));
  return set;
}

function trigramOverlap(a, b) {
  const ta = trigrams(a), tb = trigrams(b);
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / Math.max(ta.size, tb.size);
}

/** Score one entry against one token. Returns { points, reason }. broad=true relaxes
 *  thresholds and adds character-trigram similarity for typo/partial tolerance. */
function scoreToken(token, entry, broad) {
  let best = 0;
  let reason = null;

  for (const name of entry.names) {
    const lower = name.toLowerCase();
    const parts = lower.split(/[\-_]/);
    if (lower === token)              { if (100 > best) { best = 100; reason = `name '${name}' exact`; } continue; }
    if (parts.includes(token))        { if (60 > best)  { best = 60;  reason = `name '${name}' word`; } continue; }
    if (lower.includes(token))        { if (30 > best)  { best = 30;  reason = `name '${name}' substring`; } continue; }
    if (token.length >= 3) {
      const dist = levenshtein(lower, token);
      const editLimit = broad ? 3 : 2;
      if (dist <= editLimit) {
        const sim = 1 - dist / Math.max(lower.length, token.length);
        const pts = Math.round((broad ? 25 : 20) * sim);
        if (pts > best) { best = pts; reason = `name '${name}' fuzzy (edit ${dist})`; }
      }
    }
    if (broad && token.length >= 3 && lower.length >= 3) {
      const tri = trigramOverlap(lower, token);
      if (tri >= 0.4) {
        const pts = Math.round(15 * tri);
        if (pts > best) { best = pts; reason = `name '${name}' trigram (${(tri * 100).toFixed(0)}%)`; }
      }
    }
  }

  const summaryTokens = tokenize(entry.summary);
  if (summaryTokens.includes(token))           { if (12 > best) { best = 12; reason = `summary word`; } }
  else if (entry.summary.toLowerCase().includes(token)) { if (5 > best) { best = 5; reason = `summary substring`; } }

  if (tokenize(entry.argNames).includes(token)) { if (10 > best) { best = 10; reason = `arg-name`; } }
  else if (entry.argNames.toLowerCase().includes(token)) { if (4 > best) { best = 4; reason = `arg-name substring`; } }

  if (entry.argDescs.toLowerCase().includes(token)) { if (3 > best) { best = 3; reason = `arg description`; } }

  for (const ex of entry.examples) {
    if (ex.toLowerCase().includes(token)) { if (6 > best) { best = 6; reason = `example`; } break; }
  }

  if (entry.pitfalls.toLowerCase().includes(token)) { if (3 > best) { best = 3; reason = `pitfall`; } }

  return { points: best, reason };
}

// Score the corpus against the (already-expanded) per-token variant lists.
// For each (token-position, entry) we take the BEST variant score so synonyms /
// stems boost rather than pile on.
function scoreCorpus(tokenVariants, corpus, opts) {
  const broad = !!opts.broad;
  const scored = [];
  for (const entry of corpus) {
    let total = 0;
    let zeroes = 0;
    const reasons = [];
    for (const variants of tokenVariants) {
      let bestForPos = 0;
      let bestReason = null;
      let bestVariant = null;
      for (const v of variants) {
        const { points, reason } = scoreToken(v, entry, broad);
        if (points > bestForPos) { bestForPos = points; bestReason = reason; bestVariant = v; }
      }
      total += bestForPos;
      if (bestForPos > 0) {
        const label = (bestVariant !== variants[0]) ? `'${variants[0]}'→'${bestVariant}' ${bestReason}` : `'${variants[0]}' ${bestReason}`;
        reasons.push(label);
      }
      else zeroes++;
    }
    // Precise pass penalises zero-matched tokens so multi-token queries reward all-token coverage.
    // Broad pass deliberately drops the penalty — each loose match should count.
    if (!broad && zeroes > 0 && tokenVariants.length > 0) {
      total *= (tokenVariants.length - zeroes) / tokenVariants.length;
    }
    if (total > 0) {
      scored.push({
        kind: entry.kind,
        cliVerb: entry.cliVerb,
        score: Math.round(total),
        summary: entry.summary,
        matchedOn: reasons,
        firstExample: entry.examples[0] || null,
      });
    }
  }
  return scored;
}

/** Search across all schemas. Top-N results, scored. Two passes:
 *    1) precise — exact / word / substring / fuzzy(≤2) / arg / example / pitfall.
 *    2) broad   — synonym + stem expansion, fuzzy(≤3), character-trigram similarity.
 *  Pass 2 only runs if pass 1 returned fewer than `minResults` (default 10), so
 *  precise queries stay precise but vague / typo'd queries still surface ≥10 hits.
 *  Each result is tagged `pass: 'precise' | 'broad'` so the caller knows confidence.
 */
function search(query, opts = {}) {
  const limit = opts.limit || 8;
  const minResults = opts.minResults != null ? opts.minResults : 10;
  const baseTokens = tokenize(query);
  if (baseTokens.length === 0) {
    return { query, count: 0, results: [], hint: 'Empty query.' };
  }

  const corpus = buildCorpus();

  // Precise pass already expands synonyms — agents say "copy" when they mean
  // "duplicate"; the conservative SYNONYMS map handles common variants without
  // flooding results. Broad pass adds wider fuzzy + trigram + zero-token-penalty-off
  // when precise hasn't surfaced enough matches.
  const expanded = expandTokens(baseTokens);
  const preciseScored = scoreCorpus(expanded, corpus, { broad: false });
  preciseScored.sort((a, b) => b.score - a.score);
  let results = preciseScored.slice(0, Math.max(limit, minResults))
    .map(s => ({ ...s, pass: 'precise' }));

  let broadAdded = 0;
  if (results.length < minResults) {
    const broadScored = scoreCorpus(expanded, corpus, { broad: true });
    broadScored.sort((a, b) => b.score - a.score);
    const seen = new Set(results.map(r => r.kind));
    for (const r of broadScored) {
      if (results.length >= minResults) break;
      if (seen.has(r.kind)) continue;
      seen.add(r.kind);
      results.push({ ...r, pass: 'broad' });
      broadAdded++;
    }
  }

  if (results.length > limit && broadAdded === 0) {
    results = results.slice(0, limit);
  }

  let hint;
  if (results.length === 0) {
    hint = 'No matches even with broad search. Run `./bin/dreamer help` for the full kind list.';
  } else if (broadAdded > 0) {
    hint = `Precise pass found ${results.length - broadAdded}; broad pass (extended fuzzy + trigram) added ${broadAdded}. Drill down via \`./bin/dreamer help <kind>\`. Top match: ${results[0].cliVerb}.`;
  } else {
    hint = `Drill down via \`./bin/dreamer help <kind>\`. Top match: ${results[0].cliVerb}.`;
  }

  return {
    query,
    count: results.length,
    pass: broadAdded > 0 ? 'precise+broad' : 'precise',
    results,
    hint,
  };
}

module.exports = { search, buildCorpus };
