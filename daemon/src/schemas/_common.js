'use strict';

/**
 * Shared schema fragments. Cross-cutting rules + reusable arg blocks for the
 * `dreamer help` renderer.
 *
 * Schemas should:
 *   - Spread `commonArgs.target()` (or a subset) when the command takes a
 *     prefab/asset/scene-object target so every command exposes the same
 *     `--asset` / `--guid` / `--scene-object` / `--child-path` flags with
 *     consistent descriptions.
 *
 * Each arg has:
 *   - `cli`         the CLI flag agents type (structured, parsed by Claude)
 *   - `description` semantic explanation (no CLI-flag repetition — Claude
 *                   reads `cli` directly; doubling wastes tokens per
 *                   Anthropic's tool-use guidance)
 *
 * Cross-cutting rules (path syntax, value formats, focus / play-mode / multi-
 * agent rules, forbidden patterns) live in the `conventions` block and are
 * accessed via `./bin/dreamer help conventions`. Per-kind schemas reference
 * conventions rather than inlining the rules — progressive disclosure keeps
 * each schema response compact and avoids contradicting copies drifting.
 */

// ── Reusable arg blocks ──

const TARGET_ASSET = {
  type: 'string',
  cli: '--asset',
  description: 'Path to a Unity asset (prefab, material, scene, .asset, etc.).',
};

const TARGET_GUID = {
  type: 'string',
  cli: '--asset (GUID form)',
  description: 'Asset GUID — alternative to assetPath. Pass via --asset; the CLI auto-detects 32-hex strings as GUIDs.',
};

const TARGET_SCENE_OBJECT = {
  type: 'string',
  cli: '--scene-object',
  description: 'Scene-object path. See `dreamer help conventions` → pathSyntax for absolute / recursive / ambiguity rules.',
};

const CHILD_PATH = {
  type: 'string',
  cli: '--child-path',
  description: 'For prefab targets: slash-separated path of the child to act on, relative to the prefab root (e.g. "Visuals/Body"). Required when targeting a child rather than the prefab root. Same flag is used for prefab-mode reparent / rename / delete to disambiguate the GameObject inside the prefab.',
};

/**
 * Build the standard target arg block. Pass a subset list to restrict.
 *  modes (default ['asset', 'guid', 'scene', 'child']):
 *    'asset'  → assetPath  (--asset)
 *    'guid'   → guid       (--asset GUID form)
 *    'scene'  → sceneObjectPath (--scene-object)
 *    'child'  → childPath  (--child-path)
 */
function target(modes) {
  const m = modes || ['asset', 'guid', 'scene', 'child'];
  const out = {};
  if (m.includes('asset'))  out.assetPath = TARGET_ASSET;
  if (m.includes('guid'))   out.guid = TARGET_GUID;
  if (m.includes('scene'))  out.sceneObjectPath = TARGET_SCENE_OBJECT;
  if (m.includes('child'))  out.childPath = CHILD_PATH;
  return out;
}

/** Standard "at least one target form" constraint matching `target()`. */
function targetAtLeastOne(modes) {
  const m = modes || ['asset', 'guid', 'scene'];
  const fields = [];
  if (m.includes('asset')) fields.push('assetPath');
  if (m.includes('guid'))  fields.push('guid');
  if (m.includes('scene')) fields.push('sceneObjectPath');
  return { rule: 'atLeastOne', fields };
}

const commonArgs = {
  target,
  targetAtLeastOne,
  asset: TARGET_ASSET,
  guid: TARGET_GUID,
  sceneObject: TARGET_SCENE_OBJECT,
  childPath: CHILD_PATH,
};

// ── Cross-cutting conventions, rendered by `help conventions` ──

const conventions = {
  title: 'Dreamer CLI conventions — rules that apply to every command',
  appliesTo: 'All `./bin/dreamer <command>` invocations',

  universalFlags: {
    summary: 'Flags accepted by every mutation command in addition to the kind-specific args listed by `dreamer help <kind>`.',
    flags: [
      { flag: '--wait', description: 'Block until the command reaches a terminal state and surface the result. Without --wait, the CLI prints the queued command id and returns immediately. Always use --wait for mutations.' },
      { flag: '--label "<id>:<task>"', description: 'Tag the command with a free-form label visible in `status` / `queue` / `activity`. Critical when several Claude sessions drive the same project.' },
      { flag: '--allow-playmode', description: 'Override the play-mode gate. By default, scene-mutating commands are held in `waiting` while Unity is in Play Mode (changes would be lost on exit).' },
      { flag: '--no-refresh', description: 'Skip the auto-refresh-assets that the CLI prepends when `.cs` files have changed.' },
      { flag: '--focus', description: 'Force-focus Unity upfront before submitting (Windows: required for the main thread to tick).' },
      { flag: '--no-focus', description: 'Suppress all focus actions including the smart-stall fallback.' },
      { flag: '--focus-after MS', description: 'When --wait stalls past MS milliseconds, focus Unity once. Default 5000.' },
      { flag: '--no-wait-fail-fast', description: 'When --wait short-circuits on a known failure (compile errors, type-not-found), exit code is 1. Use --no-wait-fail-fast to keep waiting instead — diagnostic only.' },
    ],
  },

  targetForms: {
    summary: 'Most commands target either an asset (prefab/material/SO/scene) OR a scene-object instance. Three flag forms; pass exactly one.',
    forms: [
      { flag: '--asset PATH', description: 'Path under Assets/. CLI auto-detects 32-hex GUID strings and routes to the GUID form. Use this for prefab roots, material assets, ScriptableObjects, scene files, etc.' },
      { flag: '--asset <GUID>', description: 'Same flag, GUID literal. Useful when you have a GUID from `find-assets` and the path may have moved.' },
      { flag: '--scene-object PATH', description: 'Live scene-object instance. See pathSyntax below for absolute vs recursive search.' },
    ],
    childPath: {
      flag: '--child-path SUB',
      description: 'With --asset, descends into a child of the prefab. Slash-separated relative to the prefab root. Required when adding/removing/setting/reparenting/renaming/deleting on a prefab CHILD instead of the prefab root.',
    },
  },

  pathSyntax: {
    summary: 'Scene-object paths (used in --scene-object and the `sceneRef` value form).',
    rules: [
      '"/Root/Child/Grandchild" — absolute. First segment MUST be a root-level GameObject. No fallback.',
      '"Root/Child" — same as absolute (first segment is a root name). One match required.',
      '"Grandchild" — bare name: recursive search across all loaded scenes. Ambiguity is an error — the CLI lists every matching path.',
      '"Parent/Grandchild" — bare prefix: recursive search anywhere that chain matches.',
    ],
    notes: 'Prefab childPath uses the same slash-separated form but is always relative to the prefab root (no leading slash, never recursive).',
  },

  valueFormats: {
    summary: 'Shared value shapes for `--value` on `set-property` / `set-material-property` / similar.',
    primitives: 'Numbers and booleans pass through. Strings need JSON quoting: `--value \'"text"\'`.',
    vectors: '`{"x":1,"y":2,"z":0}`. Color: `{"r":1,"g":0,"b":0,"a":1}`.',
    references: [
      '`{"assetRef":"Assets/Prefabs/X.prefab"}` — asset reference (auto-resolves typed component fields).',
      '`{"assetRef":"Assets/Sheet.png","subAsset":"Idle_0"}` — sub-asset (Sprite inside a sprite atlas). Single-sprite imports auto-pick.',
      '`{"sceneRef":"/Path/To/Object"}` — scene-object reference.',
      '`{"guid":"<32-hex>"}` — by GUID.',
      '`{"self":true,"component":"PlayerController"}` — sibling component on the same GameObject.',
      '`{"selfChild":"Visuals/Hand","component":"SpriteRenderer"}` — descendant component, prefab-relative path.',
      '`null` — clear a reference.',
    ],
    arrays: [
      '`[v1, v2, ...]` — full replacement. `[]` clears the array.',
      '`{"_size":N,"<i>":val,...}` — sparse update: resize to N AND assign listed indices, leaving other elements untouched. Use this to APPEND past current length (Unity\'s FindProperty returns null for non-existent indices).',
      'Bracket shorthand on propertyPath: `entries[24]` is rewritten internally to `entries.Array.data[24]`. Works for nested paths too: `entries[24].itemGuid`.',
    ],
    propertyNames: 'Built-in Unity components (Transform, SpriteRenderer, Collider, Camera, etc.) serialize as `m_Pascal` (e.g. `m_Sprite`, `m_LocalPosition`). Dreamer accepts the C# camelCase form (`sprite`, `localPosition`) and falls back to `m_Sprite` etc. on lookup failure. The result JSON includes `resolvedPath`.',
    forbidden: '`m_Name` / `name` cannot be set via set-property — m_Name lives on the GameObject anchor, not a Component. Use the `rename` command.',
  },

  playModeGate: {
    summary: 'When Unity is in Play Mode, scene mutations are held in `waiting` because they\'d revert on exit. Asset mutations are NOT gated.',
    gated: 'create-gameobject, instantiate-prefab, create-hierarchy (scene mode without --save-path), and any of delete-gameobject / rename / reparent / duplicate / set-property / add-component / remove-component / remove-missing-scripts when targeting a scene object via --scene-object.',
    notGated: 'All asset-target variants, create-prefab, create-script, create-material, scene file save/open, find-assets, inspect-*, compile-status, activity, console.',
    override: '--allow-playmode per-command. Normal path: stop Play Mode in Unity and let the queue drain.',
  },

  compilation: {
    summary: 'Commands needing compiled types (add_component, remove_component, create_script, set_property when the field type is user-defined) auto-wait for compilation. The asset watcher on Assets/**/*.{cs,asmdef,asmref} fires the auto-refresh; the CLI prepends `refresh-assets --wait` if it has seen .cs changes since the last refresh.',
    statusReading: 'Read `compile-status`\'s synthesized `status` field — `ok` / `idle` / `stale` / `errors` / `compiling` / `unknown` / `disconnected`. Don\'t derive your own verdict from raw `errors` / `lastSuccess` / `compiling`.',
    stoppingRule: 'If `refresh-assets --wait` + `focus-unity` twice in a row hasn\'t changed `compile-status`, STOP retrying. Something structural is wrong (Auto Refresh disabled, file stuck on wrong importer, syntax error). Ask the user.',
  },

  multiAgent: {
    summary: 'Dreamer doesn\'t enforce coordination between multiple Claude sessions on the same project.',
    rules: [
      'Always pass `--label "<agent-id>:<task>"` on every mutation.',
      'Before drawing conclusions about errors / scene state / missing types, run `./bin/dreamer activity --since 2m` to see what other agents did.',
      'Don\'t revert your own work based on an error you didn\'t clearly cause — check `activity` first.',
    ],
  },

  forbidden: {
    summary: 'Hard policy — never do these, even if it looks easier.',
    rules: [
      'NEVER hand-edit `.unity` / `.prefab` / `.asset` / `.meta` YAML. Always go through Dreamer or the Unity Editor UI.',
      'NEVER use `set-property --property m_Name` to rename — use the `rename` command.',
      'NEVER work around a missing capability with `execute-menu-item` / `execute-method` if there\'s a first-class command. Surface the gap to the user instead.',
    ],
  },

  seeAlso: [
    './bin/dreamer help            — list documented kinds',
    './bin/dreamer help <kind>     — full schema for one command',
    '.claude/skills/dreamer/SKILL.md — narrative skill doc with workflow + failure modes',
    '.claude/skills/dreamer/property-values.md — extended value-format catalogue',
    '.claude/skills/dreamer/materials-shaders.md — material / shader workflow',
  ],
};

module.exports = {
  commonArgs,
  conventions,
};
