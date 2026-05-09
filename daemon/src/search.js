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

// Per-kind topic keywords — folded into the `names` corpus alongside the kind name,
// CLI verb, and verb aliases. These are tags an LLM is likely to type when looking
// for a feature without remembering the canonical verb (e.g. "ppu" → set_import_property,
// "atlas" → slice_sprite, "hud" → create_ui_tree, "playmode" → set_play_mode).
//
// Treated at name-tier in scoring (an exact keyword hit ranks like an exact name hit).
// Synonym expansion still applies on top, so "atlases" → stem "atlas" → keyword hit.
//
// Add entries here when you notice an LLM consistently misses the right kind despite
// schema text being unambiguous. Don't list synonyms for words already in the SYNONYMS
// map — that's redundant.
const KIND_KEYWORDS = {
  // Discovery / status
  console:                ['log', 'logs', 'debug', 'output', 'errors', 'warnings'],
  compile_status:         ['compile', 'compiling', 'csharp', 'syntax', 'verify_compile', 'check_compile'],
  shader_status:          ['pink', 'broken_shader', 'gpu_error', 'hlsl', 'verify_shader', 'check_shader'],
  find_assets:            ['glob', 'query'],
  inspect_asset:          ['examine', 'detail', 'look', 'describe'],
  inspect_hierarchy:      ['scene_tree', 'gameobjects', 'scene_dump'],
  read_property:          ['get', 'value', 'fetch'],

  // Lifecycle
  duplicate:              ['copy', 'clone', 'fork'],
  rename_gameobject:      ['rename', 'relabel', 'name'],
  reparent_gameobject:    ['move', 'reparent'],
  delete_gameobject:      ['destroy', 'kill', 'drop'],
  remove_missing_scripts: ['cleanup', 'orphan_scripts', 'missing_scripts'],
  reimport_scripts:       ['force_import', 'fix_import', 'rescan'],

  // Persistence
  save_assets:            ['persist', 'write', 'commit', 'flush'],
  refresh_assets:         ['reload', 'reimport', 'rescan', 'import'],
  open_scene:             ['load_scene'],

  // Wiring + property
  set_property:           ['wire', 'connect', 'link', 'reference', 'assign', 'field', 'variable', 'serialized'],

  // Components / scripts
  create_script:          ['monobehaviour', 'cs', 'class', 'code', 'csharp'],
  create_prefab:          ['blueprint'],
  create_hierarchy:       ['nested', 'group', 'compound'],

  // Sprite-2D
  preview_sprite:         ['render', 'visualize', 'highlight', 'see'],
  slice_sprite:           ['atlas', 'spritesheet', 'sheet', 'tileset', 'tile', 'cell', 'islands', 'subsprite'],
  extend_sprite:          ['reslice', 're-slice', 'realign', 'preserve_id', 'spriteid', 'reference_safe'],
  validate_sprite:        ['check', 'verify', 'sanity', 'orphan', 'invalid', 'broken'],
  set_import_property:    ['ppu', 'pixelsperunit', 'filter', 'filtermode', 'mipmap', 'readable', 'isreadable', 'wrap', 'wrapmode', 'maxsize', 'maxtexturesize', 'texturetype'],

  // Animation
  create_animator_controller:           ['controller', 'fsm', 'statemachine', 'animator'],
  add_animator_state:                   ['state'],
  add_animator_transition:              ['transition', 'edge'],
  add_animator_blend_tree:              ['blend', 'blendtree', 'mix'],
  add_animator_layer:                   ['layer'],
  add_animator_parameter:               ['param', 'parameter', 'animator_var'],
  set_animator_default_state:           ['entry_state', 'initial_state'],
  remove_animator_parameter:            ['delete_param'],
  remove_animator_state:                ['delete_state'],
  remove_animator_transition:           ['delete_transition'],
  remove_animator_layer:                ['delete_layer'],
  update_animator_state:                ['edit_state', 'modify_state'],
  update_animator_transition:           ['edit_transition', 'modify_transition'],
  set_animator_layer:                   ['layer_settings', 'iklayer'],
  create_animation_clip:                ['clip', 'anim'],
  set_animation_curve:                  ['curve', 'keyframe', 'tangent', 'tween', 'lerp', 'animate'],
  sample_animation_curve:               ['sample', 'evaluate', 'numeric_curve', 'verify_curve'],
  inspect_animation_clip:               ['curve_dump', 'clip_dump'],
  delete_animation_curve:               ['drop_curve'],
  set_sprite_curve:                     ['sprite_swap', 'frame_animation'],
  delete_sprite_curve:                  ['drop_sprite_curve'],
  set_animation_events:                 ['events', 'callbacks'],
  create_avatar_mask:                   ['mask', 'humanoid'],
  set_avatar_mask:                      ['mask_assign'],
  inspect_avatar_mask:                  ['mask_dump'],
  create_animator_override_controller:  ['override_controller', 'controller_variant'],
  set_animator_override_clip:           ['override_clip', 'swap_clip'],
  inspect_animator_override_controller: ['override_dump'],

  // Screenshot
  screenshot_scene:       ['render_scene', 'capture_scene', 'photo'],
  screenshot_prefab:      ['render_prefab', 'thumbnail', 'preview_prefab'],

  // Layers / tags
  set_layer:              ['physics_layer', 'rendering_layer', 'layer_assign'],
  set_layer_name:         ['name_layer', 'layer_label'],
  set_layer_collision:    ['collision_matrix'],
  add_tag:                ['tag', 'label'],
  remove_tag:             ['untag'],
  add_sorting_layer:      ['render_order', 'sprite_order', 'z_order', 'sorting'],
  remove_sorting_layer:   ['delete_sorting'],

  // Project / player settings
  set_physics_gravity:    ['gravity'],
  set_app_id:             ['bundle_id', 'package_name'],
  set_default_icon:       ['app_icon', 'launcher_icon'],
  set_app_icons:          ['platform_icons'],
  set_cursor_icon:        ['cursor', 'mouse_icon'],
  inspect_player_settings:['player_dump'],
  inspect_project_setting:['project_dump'],
  set_project_setting:    ['project_config'],
  inspect_build_scenes:   ['build_dump'],
  set_build_scenes:       ['scenes_in_build'],
  add_build_scene:        ['add_to_build'],
  remove_build_scene:     ['remove_from_build'],

  // uGUI
  create_ui_tree:         ['canvas', 'ui', 'menu', 'hud', 'panel', 'gui', 'button', 'screen'],
  inspect_ui_tree:        ['canvas_dump', 'ui_dump'],
  set_rect_transform:     ['anchor', 'pivot', 'recttransform', 'rect'],

  // Materials / shaders / particles
  set_material_property:  ['shader_property', 'mat_prop', 'tint'],
  set_material_shader:    ['shader_swap', 'reassign_shader'],
  inspect_material:       ['mat_dump'],
  inspect_shader:         ['shader_dump'],
  set_particle_property:  ['particles', 'fx', 'effect', 'emitter'],

  // FX add-on
  capture_particle:       ['particles', 'fx', 'effect', 'preview_particles', 'render_particles', 'simulate', 'visualize_fx', 'particle_screenshot', 'vfx_iteration', 'burst', 'explosion', 'spark', 'trail'],

  // Play / runtime
  set_play_mode:          ['play', 'run', 'simulate', 'runtime', 'editor_mode', 'playmode', 'start_game', 'stop'],

  // Prefab variants
  add_child_to_prefab:    ['nest', 'embed', 'add_subobject'],
  save_as_prefab:         ['extract_prefab', 'convert_to_prefab'],
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
    const keywords = KIND_KEYWORDS[kind] || [];
    const names = [kind, cliVerb, ...(aliasByKind[kind] || []), ...keywords];
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

// Hand-curated synonym map. Symmetric: a→[b] implies b→[a] elsewhere. Tokens are
// normalized lowercase. Folded into both passes (precise + broad) — agents really
// do say "copy" when they mean "duplicate" and "playmode" when they mean
// `set_play_mode`. Conservative on truly ambiguous words: "set", "key", "type",
// "value", "name", "tree", "asset", "go" deliberately have NO synonym entry — they
// appear in too many contexts to expand without flooding results. Add entries here
// when you see a recurring miss.
const SYNONYMS = {
  // create / add / build (avoid mapping "set" — too generic)
  add:          ['create', 'new', 'make', 'insert', 'attach', 'append'],
  create:       ['add', 'new', 'make', 'build', 'generate', 'instantiate'],
  new:          ['create', 'add', 'make', 'fresh'],
  fresh:        ['new'],
  make:         ['create', 'add', 'build', 'generate'],
  build:        ['create', 'make', 'generate'],
  generate:     ['create', 'make', 'build'],
  insert:       ['add', 'attach'],
  attach:       ['add', 'insert', 'connect'],
  append:       ['add'],
  init:         ['initialize', 'setup', 'create'],
  initialize:   ['init', 'setup', 'create'],
  setup:        ['init', 'initialize', 'configure'],

  // copy / duplicate / clone
  copy:         ['duplicate', 'clone'],
  duplicate:    ['copy', 'clone'],
  clone:        ['copy', 'duplicate'],
  fork:         ['duplicate', 'copy'],

  // delete / destroy
  delete:       ['remove', 'destroy', 'kill', 'drop', 'erase'],
  remove:       ['delete', 'destroy', 'drop'],
  destroy:      ['delete', 'remove', 'kill'],
  kill:         ['delete', 'destroy', 'remove'],
  erase:        ['delete', 'remove', 'clear'],
  drop:         ['delete', 'remove'],
  clear:        ['erase', 'reset', 'empty', 'delete'],
  reset:        ['clear', 'restore'],
  cleanup:      ['clear', 'remove'],

  // edit / modify
  edit:         ['modify', 'update', 'change'],
  modify:       ['edit', 'update', 'change'],
  update:       ['edit', 'modify', 'change', 'refresh'],
  change:       ['edit', 'modify', 'update', 'swap', 'replace'],
  swap:         ['replace', 'exchange', 'change'],
  replace:      ['swap', 'override', 'exchange', 'change'],
  override:     ['replace', 'overrides', 'swap'],
  overrides:    ['override'],
  exchange:     ['swap', 'replace'],
  refresh:      ['update', 'reload', 'reimport', 'rescan'],
  reload:       ['refresh', 'reimport'],
  reimport:     ['refresh', 'reload', 'rescan'],
  rescan:       ['refresh', 'reimport'],
  configure:    ['config', 'setup'],
  config:       ['configure', 'setup'],

  // inspection
  show:         ['inspect', 'preview', 'view', 'display'],
  view:         ['inspect', 'preview', 'show', 'display'],
  display:      ['show', 'view', 'render'],
  preview:      ['inspect', 'view', 'show', 'screenshot', 'capture', 'render', 'snapshot', 'visualize'],
  visualize:    ['preview', 'render', 'show', 'view'],
  inspect:      ['show', 'preview', 'view', 'examine', 'read', 'look', 'check', 'detail'],
  examine:      ['inspect', 'check'],
  read:         ['inspect', 'get', 'fetch', 'load'],
  get:          ['read', 'fetch', 'retrieve'],
  fetch:        ['get', 'retrieve', 'read'],
  retrieve:     ['get', 'fetch'],
  look:         ['inspect', 'view'],
  check:        ['inspect', 'validate', 'verify', 'examine'],
  validate:     ['check', 'verify'],
  verify:       ['check', 'validate', 'confirm'],
  confirm:      ['verify', 'check'],
  detail:       ['inspect', 'show'],
  describe:     ['inspect', 'show'],

  // search / list
  find:         ['search', 'list', 'query', 'locate', 'lookup'],
  search:       ['find', 'query', 'lookup'],
  query:        ['find', 'search', 'lookup'],
  locate:       ['find'],
  lookup:       ['find', 'search', 'query'],
  list:         ['find', 'show', 'enumerate'],
  enumerate:    ['list'],

  // spatial
  move:         ['reparent', 'relocate', 'shift', 'translate'],
  reparent:     ['parent', 'move', 'attach'],
  parent:       ['reparent'],
  relocate:     ['move', 'shift'],
  shift:        ['move', 'translate', 'offset'],
  offset:       ['shift', 'translate'],
  translate:    ['move', 'shift'],
  position:     ['place', 'locate'],
  place:        ['position', 'instantiate'],
  spawn:        ['instantiate', 'create', 'place'],
  instantiate:  ['spawn', 'create', 'place', 'instance'],
  instance:     ['instantiate'],
  rename:       ['name', 'relabel'],
  relabel:      ['rename', 'label'],

  // visual / preview
  picture:      ['screenshot', 'image', 'preview', 'photo'],
  photo:        ['screenshot', 'picture', 'image'],
  image:        ['screenshot', 'preview', 'picture', 'texture'],
  screenshot:   ['preview', 'image', 'picture', 'shot', 'capture', 'render', 'snapshot'],
  shot:         ['screenshot'],
  capture:      ['screenshot', 'render', 'snapshot'],
  render:       ['screenshot', 'draw', 'paint', 'capture', 'display'],
  draw:         ['render', 'paint'],
  paint:        ['render', 'draw'],
  snapshot:     ['capture', 'screenshot', 'preview'],
  thumbnail:    ['preview', 'screenshot', 'icon'],

  // size
  size:         ['scale', 'resize', 'dimension', 'dimensions'],
  resize:       ['size', 'scale'],
  scale:        ['size', 'resize'],
  dimension:    ['size', 'dimensions'],
  dimensions:   ['dimension', 'size'],

  // sprite-sheet authoring
  cut:          ['slice', 'split', 'divide'],
  split:        ['slice', 'cut', 'divide'],
  slice:        ['cut', 'split', 'divide', 'segment'],
  divide:       ['slice', 'split', 'cut'],
  segment:      ['slice', 'divide'],
  atlas:        ['sheet', 'spritesheet'],
  sheet:        ['atlas', 'spritesheet'],
  spritesheet:  ['atlas', 'sheet'],
  ppu:          ['pixelsperunit'],
  pixelsperunit:['ppu'],
  pivot:        ['anchor', 'origin'],
  anchor:       ['pivot', 'origin'],
  origin:       ['pivot', 'anchor'],
  alpha:        ['opacity', 'transparency', 'transparent'],
  opacity:      ['alpha', 'transparency'],
  transparency: ['alpha', 'opacity', 'transparent'],
  transparent:  ['alpha', 'opacity', 'transparency'],
  texture:      ['tex', 'image'],
  tex:          ['texture'],
  filter:       ['filtermode'],
  filtermode:   ['filter'],
  readable:     ['isreadable'],
  isreadable:   ['readable'],

  // tags / labels
  label:        ['tag', 'relabel'],
  tag:          ['tags', 'label'],
  tags:         ['tag'],

  // layers
  layer:        ['sortinglayer'],
  sortinglayer: ['layer', 'sorting'],
  sorting:      ['sortinglayer', 'order'],
  order:        ['sorting'],

  // collision / physics
  collide:      ['collision'],
  collision:    ['collide', 'physics'],
  physics:      ['collision', 'gravity', 'rigidbody'],
  rigidbody:    ['physics'],
  gravity:      ['physics'],

  // animation
  anim:         ['animation', 'clip', 'animator'],
  animation:    ['anim', 'clip', 'animator'],
  animator:     ['anim', 'animation', 'controller'],
  clip:         ['animation', 'anim'],
  curve:        ['keyframe', 'tween'],
  keyframe:     ['curve', 'keyframes'],
  keyframes:    ['keyframe'],
  tween:        ['curve', 'lerp', 'interpolate', 'animate'],
  lerp:         ['tween', 'interpolate'],
  interpolate:  ['lerp', 'tween'],
  animate:      ['tween', 'animation'],
  transition:   ['transitions'],
  transitions:  ['transition'],
  param:        ['parameter', 'parameters', 'params'],
  parameter:    ['param', 'parameters'],
  parameters:   ['parameter', 'param'],
  params:       ['param', 'parameters'],
  blend:        ['blendtree', 'mix'],
  blendtree:    ['blend'],
  mix:          ['blend'],
  mask:         ['avatarmask'],
  avatarmask:   ['mask'],
  avatar:       ['humanoid'],
  humanoid:     ['avatar'],
  controller:   ['fsm', 'statemachine', 'animator'],
  fsm:          ['controller', 'statemachine'],
  statemachine: ['controller', 'fsm'],

  // wire / reference
  wire:         ['connect', 'link', 'reference', 'assign'],
  connect:      ['wire', 'link', 'attach'],
  link:         ['wire', 'connect', 'reference'],
  reference:    ['link'],
  assign:       ['wire'],
  serialized:   ['property', 'field'],

  // persistence
  save:         ['persist', 'write', 'store', 'commit', 'flush'],
  persist:      ['save', 'store'],
  store:        ['save', 'persist'],
  write:        ['save'],
  flush:        ['save', 'persist'],
  commit:       ['save'],
  load:         ['open', 'import'],
  open:         ['load'],
  import:       ['load', 'refresh'],

  // compile / errors
  compile:      ['compiling', 'recompile'],
  compiling:    ['compile'],
  recompile:    ['compile', 'refresh'],
  syntax:       ['compile'],
  csharp:       ['cs'],
  cs:           ['csharp', 'script', 'code'],
  monobehaviour:['monobehavior', 'component', 'behavior', 'behaviour', 'script'],
  monobehavior: ['monobehaviour', 'component'],
  behavior:     ['behaviour', 'component', 'monobehaviour'],
  behaviour:    ['behavior', 'component', 'monobehaviour'],
  comp:         ['component'],
  component:    ['comp', 'monobehaviour', 'behavior', 'behaviour'],
  script:       ['scripts', 'code', 'cs'],
  scripts:      ['script'],
  code:         ['script', 'cs'],

  // play / runtime
  play:         ['run', 'simulate', 'playmode', 'runtime'],
  run:          ['play', 'execute', 'simulate'],
  simulate:     ['play', 'run'],
  playmode:     ['play'],
  runtime:      ['play'],
  start:        ['play', 'begin'],
  begin:        ['start'],
  stop:         ['end', 'halt', 'exit'],
  end:          ['stop', 'finish'],
  halt:         ['stop'],
  exit:         ['stop', 'quit'],
  quit:         ['exit', 'stop'],
  pause:        ['stop'],

  // console / logs
  console:      ['log', 'logs', 'output', 'debug'],
  log:          ['console', 'logs', 'debug', 'output'],
  logs:         ['log', 'console'],
  debug:        ['log', 'console', 'output'],
  output:       ['log', 'console'],
  warn:         ['warning', 'warnings'],
  warning:      ['warn', 'warnings'],
  warnings:     ['warning', 'warn'],
  error:        ['errors', 'exception'],
  errors:       ['error'],
  exception:    ['error', 'exceptions'],
  exceptions:   ['exception'],

  // material / shader
  mat:          ['material'],
  material:     ['mat'],
  shader:       ['shaders'],
  shaders:      ['shader'],

  // hierarchy
  hierarchy:    ['nested'],
  nested:       ['hierarchy'],
  child:        ['children', 'descendant'],
  children:     ['child'],
  descendant:   ['child'],

  // properties / fields
  field:        ['property', 'fields'],
  property:     ['field', 'properties', 'prop', 'serialized'],
  prop:         ['property'],
  properties:   ['property', 'fields'],
  fields:       ['field', 'properties'],
  variable:     ['var', 'field'],
  var:          ['variable'],
  setting:      ['settings', 'config'],
  settings:     ['setting', 'config'],

  // particles / effects
  particles:    ['particle', 'fx', 'effect'],
  particle:     ['particles'],
  fx:           ['effect', 'particles'],
  effect:       ['fx', 'particles'],

  // ui / canvas
  ui:           ['gui', 'canvas'],
  gui:          ['ui'],
  hud:          ['ui', 'overlay'],
  overlay:      ['hud', 'ui'],
  menu:         ['ui'],
  panel:        ['ui'],
  canvas:       ['ui'],

  // gameobject
  gameobject:   ['gameobjects'],
  gameobjects:  ['gameobject'],
  prefab:       ['prefabs'],
  prefabs:      ['prefab'],
  scene:        ['level'],
  level:        ['scene'],

  // toggles
  toggle:       ['enable', 'disable'],
  enable:       ['toggle', 'on'],
  disable:      ['toggle', 'off'],
  on:           ['enable'],
  off:          ['disable'],

  // queue / cancel
  queued:       ['pending', 'queue'],
  pending:      ['queue', 'queued', 'waiting'],
  waiting:      ['pending'],
  cancel:       ['cancelled', 'abort'],
  cancelled:    ['cancel'],
  abort:        ['cancel', 'stop'],

  // window / focus
  focus:        ['foreground'],
  foreground:   ['focus'],
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
    hint = 'No matches. Run `./bin/dreamer help` for the full kind list.';
  } else {
    hint = `Drill down via \`./bin/dreamer help <kind>\`. Top match: ${results[0].cliVerb}.`;
  }

  // Strip internal ranking fields (score, matchedOn, pass) — they don't change
  // what Claude does now or later. Keep only what informs tool selection or use.
  const publicResults = results.map(r => {
    const out = { kind: r.kind, cliVerb: r.cliVerb, summary: r.summary };
    if (r.firstExample) out.firstExample = r.firstExample;
    return out;
  });

  return {
    query,
    count: results.length,
    // Quick-scan list up front (single line): agents that read only the first
    // ~20 lines see every match name before the verbose summaries push them
    // out of view.
    kinds: publicResults.map(r => r.kind).join(', '),
    results: publicResults,
    hint,
  };
}

module.exports = { search, buildCorpus };
