# Changelog

All notable changes to Dreamer. Format roughly follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/).

Until the first tagged release, `main` is the live reference. After `v0.1.0`
tags, breaking changes bump the minor version (0.x.0), fixes bump patch.

## [Unreleased]

### Added — `./bin/dreamer update` now lists what changed
- `./bin/dreamer update` diffs `CHANGELOG.md` between the previous and new install and emits `changelog.newEntries[]` in the result JSON. The dreamer skill instructs Claude to read those entries to the user after a successful update — no more "the update worked" without knowing what changed.
- `CHANGELOG.md` is now copied as part of `update`, so installs stay in sync with upstream changelogs.
- `update` now copies the entire `.claude/skills/dreamer/` directory (was: only `SKILL.md`), so companion files like `tasks.md`, `property-values.md`, `materials-shaders.md` also stay current.

### Added — inspect overhaul + read-property (2026-04-25, `2da53da`)
- **`inspect-many --paths a,b,c`** — bulk-inspect N assets in one round-trip. Returns `{count, succeeded, failed, items[]}` in input order; per-item failures become `{path, error}` instead of aborting the batch.
- **`read-property`** — inverse of `set-property`. Same target args (`--asset` / `--scene-object` / `--child-path` / `--component`), returns the property value as JSON. Vectors as `{x,y,z[,w]}`, colors as `{r,g,b,a}`, ObjectReference as `{name, type, assetPath, instanceId}`. No more YAML parsing for field reads.
- **`--include-transforms`** on `inspect` / `inspect-hierarchy` / `inspect-many` — every node gets `transform: {localPosition, localEulerAngles, localScale}`.
- **`--include-fields`** on the same commands — every component gets a `fields[]` array with serialized values (primitives, vectors, colors, refs). Heavier payload — opt-in.
- **`--depth N`** on inspect commands — cap recursion. Default `-1` = unlimited; `0` = root only.
- **`inspect-hierarchy --asset PREFAB.prefab`** — dump a prefab's full hierarchy via AssetDatabase. Was scene-only — agents had to fall back to YAML parsing for prefab structure.
- **`execute-method --args '<JSON-array>'`** — pass arguments to the static method. Type-coerced against the resolved overload (`long → int`, `double → float`, enum names, primitive arrays). Escape hatch is now usable for tasks that need scratch logic.
- **`help` accepts both kinds and CLI verbs** — `./bin/dreamer help inspect-many` now resolves (was: only `help inspect_assets` worked).

### Changed — inspect shape (2026-04-25, `2da53da`)
- `inspect` recurses ALL children by default. Was 1 level deep — deeper nodes only showed `childCount`.
- `inspect_asset` and `inspect_hierarchy` now produce IDENTICAL node shape — `{type, fullType, enabled}` per component, same across root and children. Previously root used `{type, name}` and children used bare strings.
- Every node exposes `instanceId, active, tag, layer, isStatic, childCount` (asset side previously only had components + 1-level children).

### Fixed (2026-04-25, `2da53da`)
- Schema validator recognizes the `integer` type (was: every schema field declared `integer` errored at validation time).
- `save-assets` now also saves dirty open scenes via `EditorSceneManager.SaveOpenScenes`. Previously scene-object mutations stayed in-memory after a "successful" save-assets call — `git diff` showed nothing.

### Added — scene/prefab editing (2026-04-19 → 2026-04-21)
- **`reparent` command** (`677c883`) — works in both scenes (`--scene-object`) and prefabs (`--asset --child-path`). Flags: `--new-parent`, `--keep-world-space`, `--sibling-index`. Cycle guard refuses self-/descendant-parenting with a chain in the error.
- **`set-property` rejects `m_Name` with a directive** (`6e90f88`) — points the caller at `rename` instead of returning a cryptic "Property not found on Component".

### Added — documentation surface (2026-04-19 → 2026-04-25)
- **All 38 command kinds have structured schemas** (`7c9dc3a`) — `./bin/dreamer help <kind>` returns args, examples, pitfalls, result shape.
- **`help conventions`** — cross-cutting rules (target forms `--asset` / `--scene-object` / `--child-path`, value formats for refs / sub-assets / sparse arrays, play-mode gating, multi-agent rules, forbidden patterns) factored out so per-kind schemas don't repeat them.
- **Per-schema `pitfalls[]` arrays** (`111390b`) — anti-patterns and "wrong → right" pairs surface inline next to the args.
- **`unity-scene-builder` subagent** (`677c883`) — translates scene descriptions to a sequence of Dreamer CLI calls.
- **`tasks.md` task→command index** (`111390b`) — flat lookup table for common workflows in the dreamer skill.

### Added — uGUI add-on (optional, shipped as `com.dreamer.agent-bridge.ugui`)
- **Separate Unity package** with its own asmdef, auto-registered into core
  via a reflection-based plugin hook in `CommandDispatcher`. Core Dreamer
  compiles and runs identically whether or not the add-on is installed.
- **Three public commands** — the entire UI-building surface:
  - `create-ui-tree --json JSON_OR_@file` — declarative tree builder.
    Modes: `create` / `append` / `replace-children` / `replace-self`.
    Starts at any level of the hierarchy, not just Canvas roots — agents
    can rebuild one panel without touching the surrounding UI. Node types:
    Panel, Image, Text, Button, VStack, HStack, Grid, ScrollList, Slider,
    Toggle, InputField, Spacer, Raw (escape hatch for custom
    MonoBehaviours).
  - `inspect-ui-tree --target PATH [--depth N]` — round-trip inspector.
    Dumps an existing UI subtree to the same schema the builder consumes.
    Recognized widgets get their type; unrecognized GOs become `Raw` with
    `components[]` preserved. Enables the read-edit-rebuild workflow.
  - `set-rect-transform (--scene-object PATH | --asset PATH) [--anchor
    PRESET] [--size WxH] [--pivot X,Y]` — one-call anchor/size/pivot
    configuration with 16 named presets (`center`, `top-stretch`, `fill`,
    etc.) instead of six brittle `set-property` calls.
- **`./bin/dreamer addon` subcommand** — `list` / `install <name>` /
  `remove <name>`. Installed add-ons are recorded in
  `daemon/.dreamer-source.json`'s `addons[]` field; `./bin/dreamer update`
  honors that list and refreshes them alongside core.
- **Separate skill file** at `.claude/skills/dreamer-ugui/SKILL.md` with a
  companion `schema.md` reference. Auto-loads only when the agent
  encounters UI-flavored task language (Canvas, Button, HUD, menu, etc.),
  so core Dreamer sessions pay no context cost for UI docs.
- **Design principle**: the UI scaffold Claude builds is intentionally
  legible-not-perfect — the user refines visually in Unity's Scene/Game
  view afterward. Claude's job is correct hierarchy + anchoring; Unity's
  job is pixel polish.

### Added — core
- **Material + shader commands** — closes a gap where materials couldn't
  be created or meaningfully edited via Dreamer (the generic set-property
  path didn't reach Unity's `MaterialProperty` API). Six new commands:
  - `create-material --name X [--path FOLDER] [--shader "Shader/Name"]` —
    creates a new `.mat` asset, falls back to Standard/URP-Lit/HDRP-Lit
    when `--shader` omitted (warning in result JSON).
  - `inspect-material --asset X.mat` — returns shader + full property
    list (name, display name, type, current value, range for Range props)
    + active keywords + render queue.
  - `set-material-property --asset X.mat --property _BaseColor --value
    '{"r":1,...}'` — routes by shader-declared property type to the right
    MaterialProperty setter. Color / Vector / Float / Int / Range / Texture
    values supported. Keyword form: `--keyword _EMISSION --enable true`.
  - `set-material-shader --asset X.mat --shader "Name"` — reassigns shader
    (Unity preserves compatible property values).
  - `shader-status [--asset X.shader]` — wraps `ShaderUtil.GetShaderMessages`.
    No-arg form scans every user shader under Assets/. Returns
    `status: ok|warnings|errors` plus per-message severity/text/file/line.
  - `inspect-shader (--asset X.shader | --shader "Name")` — declared
    property list + keywords + render queue + maximum LOD + any existing
    compile messages.
  Writing shader source is the same as writing .cs: direct file write +
  `refresh-assets`. There is no `create-shader` command — templates vary
  too much per render pipeline to be useful from Dreamer.
- **Play Mode gate for scene-edit commands.** Scene mutations made during
  Play Mode silently revert on exit (Unity's design — only EditMode edits
  persist). Dreamer now holds such commands in `waiting` with reason
  *"Play Mode active — scene edits would be lost on exit. Stop Play Mode
  in Unity (or submit with --allow-playmode to override)."* Gated kinds:
  `create_gameobject`, `instantiate_prefab`, `create_hierarchy` (scene
  mode, no `savePath`), and any `add_component` / `remove_component` /
  `set_property` / `delete_gameobject` / `rename_gameobject` /
  `duplicate` / `remove_missing_scripts` targeting a scene object. Asset
  targets, script writes, and read-only commands are not gated. Override
  flag: `--allow-playmode` on the CLI (serialized as
  `options.allowPlayMode` in the API).
- **`./bin/dreamer activity`** — newest-first view of recent commands across
  the queue, with per-entry label / kind / state / age / duration. Built for
  multi-agent visibility: when several Claude sessions drive the same
  project, each agent can call `activity --since 2m` before drawing
  conclusions about compile errors or scene state. Flags: `--limit N`,
  `--since 90s|5m|1h`, `--state X`. Exposed at `GET /api/activity`.
- **`--label TEXT` flag promoted as a first-class tool** in CLI help +
  SKILL.md. The flag already existed (as `humanLabel`); it's now documented
  as the canonical way to tag commands in parallel-agent scenarios, e.g.
  `--label "sessionA:player-setup"`. Labels appear in `status`, `queue`,
  and `activity` output.
- **SKILL.md "Parallel agent sessions" section** — tool-focused guidance,
  no prescriptive coordination protocol. Core rule: check
  `activity --since 2m` before blaming yourself for compile errors in
  multi-agent workflows.
- **`refresh-assets` auto-heal for "Unknown type" script misclassification.**
  Unity sometimes imports a `.cs` file via `DefaultImporter` (unknown asset
  type) instead of `MonoImporter` when the write lands while the Editor is
  unfocused on Windows. The MonoScript subasset never gets generated, so
  `add-component` fails and the script can't be dragged onto a GameObject.
  The daemon-side asset watcher now tracks which `.cs` files changed since
  the last refresh, and `refresh-assets` force-reimports any file Unity
  didn't classify as MonoScript. Result JSON includes `reimported[]` and
  `misclassified[]`.
- **`reimport-script` rescue command** — force-reimports `.cs` files under a
  path (file or folder, recursive by default), then kicks
  `CompilationPipeline.RequestScriptCompilation()`. Use when the auto-heal
  in `refresh-assets` didn't catch a misclassified file, or when the watcher
  missed the original write.
- **`set-property` property-name aliasing for built-in components** —
  Unity built-ins serialize as `m_Pascal` (e.g. `m_Sprite`, `m_LocalPosition`).
  The CLI now accepts the C# camelCase form (`sprite`, `localPosition`,
  `color`, `isTrigger`) and falls back to `m_<Cap>` on lookup failure. The
  result JSON includes `resolvedPath` so callers see which form Unity used.
  User-defined `[SerializeField]` fields keep their declared name unchanged.
- **`create-hierarchy` now surfaces component warnings instead of dropping
  silently.** Unknown types, not-a-Component types, and duplicates get
  recorded into a `warnings[]` array in the result JSON with the node path
  and reason.
- **`compile-status` summary shows age next to timestamps.**
  `Last observed clean compile: 2026-04-19T14:22:11Z (3m 14s ago).`

### Fixed
- **`set-property` on sprite sub-asset references** (SpriteRenderer.m_Sprite
  and similar) no longer silently no-ops. Previously, `assetRef` pointing at
  a Texture2D resolved to the main Texture asset and Unity silently dropped
  the cross-type assignment, leaving `m_Sprite: {fileID: 0}`. The object-ref
  resolver now:
  - Accepts an explicit `"subAsset": "name"` modifier to pick a named
    sub-asset (required for Multiple-mode sprite atlases).
  - When the field type can't be resolved via reflection (common for Unity
    built-in component fields), probes the main asset + each sub-asset
    against the SerializedProperty and auto-picks the one Unity accepts.
  - When multiple sub-assets match, returns an error listing candidates
    so the caller can disambiguate with `subAsset` — no more silent wrong
    assignment.
- **Prefab-editing commands no longer overwrite a successful outcome with
  a UnloadPrefabContents cleanup error.** `PrefabUtility.SaveAsPrefabAsset`
  sometimes disposes the internal scene backing the prefabRoot, so the
  subsequent `PrefabUtility.UnloadPrefabContents` throws "Specified object
  is not part of Prefab contents" — despite the save having already
  landed. Previously this threw the command into `failed` state even
  though the prefab asset was correct on disk. Now every Op that loads
  prefab contents uses `PrefabOps.SafeUnloadPrefabContents`, which
  swallows the cleanup error (the mutation is already persisted) and logs
  a diagnostic. Fixes the reported `add-component --asset` "error but
  component was actually applied" pattern.
- **`lastCompileSuccess` now updates on every compile**, not just the first
  one after daemon startup. The previous logic had two guards that both
  missed the common case: the bridge-restore path only ran when the value
  was null, and the edge-detection path required the daemon to observe
  `compiling: true → false` directly (short compiles finish between state
  ticks, so the edge was never registered). Bridge timestamp is now
  accepted monotonically — whenever newer than the current record. Fixes
  the "force-compile, check timestamp, retry" agent loop where
  `compile-status` reported an old timestamp despite Unity having
  re-compiled.

### Changed
- **Dreamer CLI reference moved from slash command to Claude Code skill.**
  The reference now lives at `.claude/skills/dreamer/SKILL.md` (auto-loaded
  by Claude when Unity work appears) instead of `.claude/commands/dreamer.md`
  (user-invoked only via `/dreamer`). `./bin/dreamer update` migrates
  pre-existing installs — it removes the legacy file after copying the new
  skill. Fresh installs write only the skill.
- **SKILL.md prioritizes the synthesized `compile-status` fields.** New
  section at the top of the compile-status docs tells agents to read
  `body.status` + `summary` as source of truth rather than computing
  verdicts from raw `errors` / `lastSuccess` / `compiling` fields, plus a
  stop-retrying rule after two failed refresh-assets cycles. Mitigates the
  agent-loop pattern reported in Blackend Core use.

## [0.1.0-pre]

This section captures the major milestones since the initial commit on the
way to the first tagged release. Individual commit SHAs are listed for
reference.

### Added (major features since initial commit)
- Self-update via `./bin/dreamer update` + installer (`7ec1db7`)
- Project-local install model — no global npm link (`93d0ed0`)
- Project-local CLI wrappers in `bin/` (`4fafe7f`)
- Multi-project support: shared projects registry with port auto-allocation,
  HTTP 409 `wrong-project` enforcement, `probe-port` helper (`1cb9d1f` +
  follow-up work in recent main)
- Smart focus policy: stall-based fallback, tunable via
  `focusStallMs`/`--focus-after` (`9e2d71c`, `a7f0963`)
- Compile-error short-circuit + race-fix + stale-reason handling (`39deb0c`)
- Filesystem watcher + auto-refresh + global compile gate (`0a0c60b`)
- Stale asset-DB diagnostic hint for direct-written `.cs` files (`cfb9480`)
- Structured daemon logs (JSON lines) + colored TTY output (`d91a02d`)
- Command schema registry + daemon-side validation + `help` CLI (`dbdc2cb`)
- Scene/prefab feature parity, rename, duplicate, delete (`6198347`,
  `7f55857`)
- `create-hierarchy` for arbitrary-depth scene/prefab trees (`a1e00ce`)
- `remove-missing-scripts` for scrubbing orphan components after script
  deletion (single prefab, scene object, or folder scan; dry-run supported)
- `status` / `compile-status` with synthesized status enum
  (disconnected/unknown/compiling/errors/stale/idle/ok), per-timestamp ages,
  `queue.active[]` diagnostic view
- Scheduler observability (tick count, last-dispatch metrics) + stuck-running
  sweep timeout (default 60s, overridable per command)
- Scene-object path resolution: multi-scene, recursive, ambiguity detection
  (no more silent misroutes on name collisions)
- `set-property` struct/array support, including struct arrays, sparse
  updates (`{"_size":N,"0":...}`), nested structs, `self`/`selfChild` and
  component-override references
- Config file (`daemon/.dreamer-config.json`) + source tracking
  (`daemon/.dreamer-source.json`) for self-update drift detection
- 44-test daemon test suite (`44fe886`)
- macOS compatibility notes (`d0795ed`)
- Daemon README + branded console logs (`256af5e`)

### Architecture
- Three-layer design: CLI → Node.js daemon (localhost HTTP) ← Unity C#
  bridge (polling client)
- Daemon survives Unity domain reloads; Unity re-attaches on boot
- CLI auto-starts daemon on first invocation
