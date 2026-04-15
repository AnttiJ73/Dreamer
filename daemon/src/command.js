'use strict';

const crypto = require('crypto');

// ── Known command kinds and their default requirements ──────────────────────

const KIND_DEFS = {
  find_assets:      { label: 'Find Assets',       requirements: null },
  inspect_asset:    { label: 'Inspect Asset',      requirements: null },
  create_script:    { label: 'Create Script',      requirements: { compilation: true } },
  add_component:    { label: 'Add Component',      requirements: { compilation: true } },
  remove_component: { label: 'Remove Component',   requirements: { compilation: true } },
  set_property:     { label: 'Set Property',       requirements: null },
  create_prefab:    { label: 'Create Prefab',      requirements: null },
  create_gameobject:{ label: 'Create GameObject',  requirements: null },
  delete_gameobject:{ label: 'Delete GameObject',  requirements: null },
  rename_gameobject:{ label: 'Rename',             requirements: null },
  duplicate:        { label: 'Duplicate',           requirements: null },
  instantiate_prefab:{ label: 'Instantiate Prefab', requirements: null },
  inspect_hierarchy:{ label: 'Inspect Hierarchy',  requirements: null },
  save_assets:      { label: 'Save Assets',        requirements: null },
  refresh_assets:   { label: 'Refresh Assets',     requirements: null },
  compile_status:   { label: 'Compile Status',     requirements: null },
  console:          { label: 'Console',            requirements: null },
  add_child_to_prefab: { label: 'Add Child to Prefab', requirements: null },
  save_as_prefab:      { label: 'Save As Prefab',      requirements: null },
  execute_menu_item:   { label: 'Execute Menu Item',   requirements: null },
  execute_method:      { label: 'Execute Method',      requirements: null },
  create_scene:        { label: 'Create Scene',        requirements: null },
  open_scene:          { label: 'Open Scene',          requirements: null },
  save_scene:          { label: 'Save Scene',          requirements: null },
  create_scriptable_object: { label: 'Create ScriptableObject', requirements: { compilation: true } },
  create_hierarchy:    { label: 'Create Hierarchy',    requirements: null },
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
  'inspect_hierarchy',
  'create_scene',
  'open_scene',
]);

function isCompileSafe(kind) {
  return COMPILE_SAFE_KINDS.has(kind);
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
  STATES,
  TERMINAL_STATES,
  COMPILE_SAFE_KINDS,
  KIND_DEFS,
};
