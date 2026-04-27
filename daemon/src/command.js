'use strict';

const crypto = require('crypto');

// ── Known command kinds and their default requirements ──────────────────────

const KIND_DEFS = {
  find_assets:      { label: 'Find Assets',       requirements: null },
  inspect_asset:    { label: 'Inspect Asset',      requirements: null },
  inspect_assets:   { label: 'Inspect Assets',     requirements: null },
  create_script:    { label: 'Create Script',      requirements: { compilation: true } },
  add_component:    { label: 'Add Component',      requirements: { compilation: true } },
  remove_component: { label: 'Remove Component',   requirements: { compilation: true } },
  remove_missing_scripts: { label: 'Remove Missing Scripts', requirements: null },
  set_property:     { label: 'Set Property',       requirements: null },
  read_property:    { label: 'Read Property',      requirements: null },
  create_prefab:    { label: 'Create Prefab',      requirements: null },
  create_gameobject:{ label: 'Create GameObject',  requirements: null },
  delete_gameobject:{ label: 'Delete GameObject',  requirements: null },
  rename_gameobject:{ label: 'Rename',             requirements: null },
  reparent_gameobject:{ label: 'Reparent GameObject', requirements: null },
  duplicate:        { label: 'Duplicate',           requirements: null },
  instantiate_prefab:{ label: 'Instantiate Prefab', requirements: null },
  inspect_hierarchy:{ label: 'Inspect Hierarchy',  requirements: null },
  save_assets:      { label: 'Save Assets',        requirements: null },
  refresh_assets:   { label: 'Refresh Assets',     requirements: null },
  reimport_scripts: { label: 'Reimport Scripts',   requirements: null },
  compile_status:   { label: 'Compile Status',     requirements: null },
  console:          { label: 'Console',            requirements: null },
  add_child_to_prefab: { label: 'Add Child to Prefab', requirements: null },
  save_as_prefab:      { label: 'Save As Prefab',      requirements: null },
  execute_menu_item:   { label: 'Execute Menu Item',   requirements: null },
  execute_method:      { label: 'Execute Method',      requirements: null },
  set_play_mode:       { label: 'Set Play Mode',       requirements: null },
  create_scene:        { label: 'Create Scene',        requirements: null },
  open_scene:          { label: 'Open Scene',          requirements: null },
  save_scene:          { label: 'Save Scene',          requirements: null },
  create_scriptable_object: { label: 'Create ScriptableObject', requirements: { compilation: true } },
  create_hierarchy:    { label: 'Create Hierarchy',    requirements: null },

  // Material + shader operations
  create_material:       { label: 'Create Material',       requirements: null },
  inspect_material:      { label: 'Inspect Material',      requirements: null },
  set_material_property: { label: 'Set Material Property', requirements: null },
  set_material_shader:   { label: 'Set Material Shader',   requirements: null },
  shader_status:         { label: 'Shader Status',         requirements: null },
  inspect_shader:        { label: 'Inspect Shader',        requirements: null },

  // ParticleSystem (modules access pattern that generic set_property can't reach)
  set_particle_property: { label: 'Set Particle Property', requirements: null },

  // UI Canvas (uGUI) add-on — kinds are known here so the CLI + scheduler
  // treat them uniformly, but the bridge-side handlers only exist when
  // the add-on package is installed. If the add-on is missing, the
  // dispatcher returns a clear "Unknown command kind" error and the CLI
  // short-circuits with a hint to install `com.dreamer.agent-bridge.ugui`.
  set_rect_transform:  { label: 'Set RectTransform',  requirements: null },
  create_ui_tree:      { label: 'Build UI Tree',      requirements: null },
  inspect_ui_tree:     { label: 'Inspect UI Tree',    requirements: null },

  // Animation add-on — provided by `com.dreamer.agent-bridge.animation`.
  // Same install-conditional model as ugui.
  create_animation_clip:  { label: 'Create AnimationClip',  requirements: null },
  set_animation_curve:    { label: 'Set Animation Curve',   requirements: null },
  inspect_animation_clip: { label: 'Inspect AnimationClip', requirements: null },
  sample_animation_curve: { label: 'Sample Animation Curve', requirements: null },
  delete_animation_curve: { label: 'Delete Animation Curve', requirements: null },
  set_sprite_curve:       { label: 'Set Sprite Curve',       requirements: null },
  delete_sprite_curve:    { label: 'Delete Sprite Curve',    requirements: null },
  set_animation_events:   { label: 'Set Animation Events',   requirements: null },

  create_animator_controller: { label: 'Create Animator Controller', requirements: null },
  add_animator_parameter:     { label: 'Add Animator Parameter',     requirements: null },
  add_animator_state:         { label: 'Add Animator State',         requirements: null },
  add_animator_transition:    { label: 'Add Animator Transition',    requirements: null },
  set_animator_default_state: { label: 'Set Animator Default State', requirements: null },
  inspect_animator_controller:{ label: 'Inspect Animator Controller',requirements: null },
};

// ── Valid states and allowed transitions ─────────────────────────────────────

const STATES = [
  'queued', 'waiting', 'dispatched', 'running',
  'succeeded', 'failed', 'blocked', 'cancelled',
];

const TERMINAL_STATES = new Set(['succeeded', 'failed', 'blocked', 'cancelled']);

/**
 * Kinds that Unity's CommandDispatcher will execute even during compilation.
 * Mirror of the Unity-side IsCompileSafe list in
 * Packages/com.dreamer.agent-bridge/Editor/Core/CommandDispatcher.cs —
 * keep the two in sync when adding commands.
 *
 * Every other kind must wait for compilation to finish before dispatch,
 * or Unity will reject it mid-flight with "Cannot execute this command
 * while Unity is compiling." That rejection surfaces as a terminal
 * `failed` state, which is worse than holding the command in `waiting`
 * until Unity is ready.
 */
const COMPILE_SAFE_KINDS = new Set([
  'find_assets',
  'inspect_asset',
  'inspect_assets',
  'inspect_hierarchy',
  'inspect_material',
  'inspect_shader',
  'shader_status',
  'read_property',
  'create_scene',
  'open_scene',
]);

function isCompileSafe(kind) {
  return COMPILE_SAFE_KINDS.has(kind);
}

/**
 * Decide whether a command (kind + args) mutates scene state that would be
 * lost when Unity exits Play Mode. The scheduler gates such commands when
 * `unityState.playMode` is true — a scene-edit made during Play Mode looks
 * successful in the agent's result JSON but silently reverts the moment
 * Play Mode ends, which is a miserable debugging experience.
 *
 * Persistent edits (prefab assets, scene save-asset files, materials,
 * scripts) are fine in Play Mode — only live-scene mutations need gating.
 *
 * Most ambiguous kinds (add_component, set_property, etc.) branch on
 * whether `sceneObjectPath` is present in args — that's the daemon's
 * signal that the target is a live scene object vs. an on-disk prefab.
 *
 * @param {string} kind
 * @param {object} [args]
 * @returns {boolean}
 */
function mutatesScene(kind, args) {
  const a = args || {};
  switch (kind) {
    // Always scene-resident — no asset-mode alternative.
    case 'create_gameobject':
    case 'instantiate_prefab':
      return true;

    // Scene mode unless `savePath` was given (then it saves straight to a
    // prefab asset — the temp scene GO is destroyed immediately).
    case 'create_hierarchy':
      return !a.savePath;

    // Ambiguous kinds: scene-edit only when targeting a scene object.
    case 'delete_gameobject':
    case 'rename_gameobject':
    case 'duplicate':
    case 'set_property':
    case 'set_particle_property':
    case 'add_component':
    case 'remove_component':
    case 'remove_missing_scripts':
      return !!a.sceneObjectPath;

    // Reparent has two modes: scene (sceneObjectPath) and prefab asset
    // (assetPath/guid + childPath). Only scene mode mutates the scene.
    case 'reparent_gameobject':
      return !!a.sceneObjectPath;

    // UGUI add-on: tree builder always writes to scene (or within a scene's
    // canvas). Prefab-scoped UI editing goes through existing set-property /
    // add-component on the prefab asset.
    case 'create_ui_tree':
      return true;

    // Inspection is a read — no scene mutation, safe in Play Mode.
    case 'inspect_ui_tree':
      return false;

    // set_rect_transform targets either a scene object (scene-edit) or a
    // prefab asset (safe in Play Mode — the asset is the edit target).
    case 'set_rect_transform':
      return !!a.sceneObjectPath;

    // Read-only or asset-only kinds.
    default:
      return false;
  }
}

/**
 * Map from current state → set of states it may transition to.
 * Any transition not listed here is illegal.
 */
const TRANSITIONS = {
  queued:      new Set(['waiting', 'dispatched', 'blocked', 'cancelled']),
  // waiting → waiting is intentional: lets the scheduler update waitingReason
  // as blocking conditions change (e.g. "unity_disconnected" → "Compile errors present").
  waiting:     new Set(['waiting', 'queued', 'dispatched', 'blocked', 'cancelled']),
  dispatched:  new Set(['running', 'waiting', 'queued', 'failed', 'cancelled']),
  running:     new Set(['succeeded', 'failed', 'cancelled']),
  succeeded:   new Set(),
  failed:      new Set(),
  blocked:     new Set(['cancelled']),
  cancelled:   new Set(),
};

/**
 * Validate that a state transition is allowed.
 * @param {string} from
 * @param {string} to
 * @returns {{ valid: boolean, reason?: string }}
 */
function validateTransition(from, to) {
  if (!TRANSITIONS[from]) return { valid: false, reason: `Unknown state: ${from}` };
  if (!TRANSITIONS[from].has(to)) {
    return { valid: false, reason: `Cannot transition from '${from}' to '${to}'` };
  }
  return { valid: true };
}

/**
 * Create a new command object.
 * @param {string} kind - One of the known command kinds
 * @param {object} args - Command-specific arguments
 * @param {object} [options] - Optional overrides
 * @param {string} [options.originTaskId]
 * @param {string} [options.humanLabel]
 * @param {number} [options.priority]
 * @param {string} [options.dependsOn]
 * @param {object} [options.requirements] - Override auto-detected requirements
 * @param {boolean} [options.allowPlayMode] - Bypass the Play Mode scene-edit
 *   gate for this command. Use sparingly — scene edits made during Play Mode
 *   revert on exit, so setting this flag is a claim that the caller knows
 *   the effect is intentional (e.g. runtime debugging).
 * @returns {object} Command object
 */
function createCommand(kind, args, options = {}) {
  const def = KIND_DEFS[kind];
  if (!def) {
    throw new Error(`Unknown command kind: '${kind}'. Valid kinds: ${Object.keys(KIND_DEFS).join(', ')}`);
  }

  const now = new Date().toISOString();

  // Merge auto requirements with explicit overrides
  const autoReqs = def.requirements ? { ...def.requirements } : null;
  const reqs = options.requirements
    ? { ...(autoReqs || {}), ...options.requirements }
    : autoReqs;

  return {
    id: crypto.randomUUID(),
    kind,
    args: args || {},
    state: 'queued',
    waitingReason: null,
    requirements: reqs,
    dependsOn: options.dependsOn || null,
    priority: options.priority || 0,
    allowPlayMode: !!options.allowPlayMode,
    createdAt: now,
    updatedAt: now,
    dispatchedAt: null,
    completedAt: null,
    result: null,
    error: null,
    attemptCount: 0,
    originTaskId: options.originTaskId || null,
    humanLabel: options.humanLabel || def.label,
  };
}

/**
 * @param {string} kind
 * @returns {boolean}
 */
function isKnownKind(kind) {
  return kind in KIND_DEFS;
}

/**
 * @param {string} state
 * @returns {boolean}
 */
function isTerminalState(state) {
  return TERMINAL_STATES.has(state);
}

module.exports = {
  createCommand,
  validateTransition,
  isKnownKind,
  isTerminalState,
  isCompileSafe,
  mutatesScene,
  STATES,
  TERMINAL_STATES,
  COMPILE_SAFE_KINDS,
  KIND_DEFS,
};
