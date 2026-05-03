'use strict';

const crypto = require('crypto');

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
  set_layer:        { label: 'Set Layer',          requirements: null },
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

  // Project Settings — convenience commands + generic editor for the long tail.
  inspect_project_settings: { label: 'Inspect Project Settings', requirements: null },
  set_layer_name:        { label: 'Set Layer Name',        requirements: null },
  clear_layer:           { label: 'Clear Layer',           requirements: null },
  add_tag:               { label: 'Add Tag',               requirements: null },
  remove_tag:            { label: 'Remove Tag',            requirements: null },
  add_sorting_layer:     { label: 'Add Sorting Layer',     requirements: null },
  remove_sorting_layer:  { label: 'Remove Sorting Layer',  requirements: null },
  set_layer_collision:   { label: 'Set Layer Collision',   requirements: null },
  set_physics_gravity:   { label: 'Set Physics Gravity',   requirements: null },
  set_project_setting:   { label: 'Set Project Setting',   requirements: null },
  inspect_project_setting:{ label: 'Inspect Project Setting',requirements: null },

  // PlayerSettings static-API wrappers (icons, cursor, per-platform app id).
  inspect_player_settings: { label: 'Inspect PlayerSettings', requirements: null },
  set_app_id:              { label: 'Set Application Id',     requirements: null },
  set_default_icon:        { label: 'Set Default Icon',       requirements: null },
  set_app_icons:           { label: 'Set App Icons',          requirements: null },
  set_cursor_icon:         { label: 'Set Cursor Icon',        requirements: null },

  // Visual feedback — render assets to PNG.
  screenshot_prefab:       { label: 'Screenshot Prefab',      requirements: null },
  screenshot_scene:        { label: 'Screenshot Scene',       requirements: null },

  // EditorBuildSettings build-scenes.
  inspect_build_scenes:    { label: 'Inspect Build Scenes',   requirements: null },
  set_build_scenes:        { label: 'Set Build Scenes',       requirements: null },
  add_build_scene:         { label: 'Add Build Scene',        requirements: null },
  remove_build_scene:      { label: 'Remove Build Scene',     requirements: null },
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

  // Generic AssetImporter property setter (TextureImporter / ModelImporter / AudioImporter / …).
  set_import_property:   { label: 'Set Import Property',   requirements: null },

  // Sprite 2D add-on — provided by `com.dreamer.agent-bridge.sprite-2d`.
  // Same install-conditional model as ugui/animation.
  preview_sprite:        { label: 'Preview Sprite',        requirements: null },
  slice_sprite:          { label: 'Slice Sprite',          requirements: null },
  extend_sprite:         { label: 'Extend Sprite',         requirements: null },

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

  // Phase 2 — iteration ergonomics + multi-layer + blend trees + masks + overrides
  remove_animator_parameter:  { label: 'Remove Animator Parameter',  requirements: null },
  remove_animator_state:      { label: 'Remove Animator State',      requirements: null },
  remove_animator_transition: { label: 'Remove Animator Transition', requirements: null },
  update_animator_state:      { label: 'Update Animator State',      requirements: null },
  update_animator_transition: { label: 'Update Animator Transition', requirements: null },
  add_animator_layer:         { label: 'Add Animator Layer',         requirements: null },
  remove_animator_layer:      { label: 'Remove Animator Layer',      requirements: null },
  set_animator_layer:         { label: 'Set Animator Layer',         requirements: null },
  add_animator_blend_tree:    { label: 'Add Animator BlendTree',     requirements: null },
  create_avatar_mask:         { label: 'Create AvatarMask',          requirements: null },
  set_avatar_mask:            { label: 'Set AvatarMask',             requirements: null },
  inspect_avatar_mask:        { label: 'Inspect AvatarMask',         requirements: null },
  create_animator_override_controller: { label: 'Create Animator Override Controller', requirements: null },
  set_animator_override_clip:          { label: 'Set Animator Override Clip',          requirements: null },
  inspect_animator_override_controller:{ label: 'Inspect Animator Override Controller', requirements: null },
};

const STATES = [
  'queued', 'waiting', 'dispatched', 'running',
  'succeeded', 'failed', 'blocked', 'cancelled',
];

const TERMINAL_STATES = new Set(['succeeded', 'failed', 'blocked', 'cancelled']);

// Kinds Unity will execute mid-compile. KEEP IN SYNC with the C# IsCompileSafe
// list in Packages/com.dreamer.agent-bridge/Editor/Core/CommandDispatcher.cs.
// Anything not listed gets held in `waiting` until compile finishes — Unity
// would otherwise reject mid-flight and the command would terminate as failed.
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
  'inspect_project_settings',
  'inspect_project_setting',
  'inspect_player_settings',
  'inspect_build_scenes',
]);

function isCompileSafe(kind) {
  return COMPILE_SAFE_KINDS.has(kind);
}

/**
 * True if (kind, args) edits scene state that would revert on Play Mode exit.
 * Scheduler gates these when playMode is true. Persistent edits (prefabs,
 * scene asset files, materials, scripts) are safe — only live-scene mutations
 * need gating. Ambiguous kinds branch on sceneObjectPath being present.
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
    case 'set_layer':
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

/** State → set of legal next states. Anything else is rejected. */
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

function validateTransition(from, to) {
  if (!TRANSITIONS[from]) return { valid: false, reason: `Unknown state: ${from}` };
  if (!TRANSITIONS[from].has(to)) {
    return { valid: false, reason: `Cannot transition from '${from}' to '${to}'` };
  }
  return { valid: true };
}

/** Build a new command object. options.allowPlayMode bypasses the play-mode scene-edit gate. */
function createCommand(kind, args, options = {}) {
  const def = KIND_DEFS[kind];
  if (!def) {
    throw new Error(`Unknown command kind: '${kind}'. Valid kinds: ${Object.keys(KIND_DEFS).join(', ')}`);
  }

  const now = new Date().toISOString();

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

function isKnownKind(kind) {
  return kind in KIND_DEFS;
}

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
