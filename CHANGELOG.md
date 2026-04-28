# Changelog

All notable changes to Dreamer. Format roughly follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/).

Until the first tagged release, `main` is the live reference. After `v0.1.0`
tags, breaking changes bump the minor version (0.x.0), fixes bump patch.

## [Unreleased]

### Added — `screenshot-prefab` (visual feedback for agents)
- **`./bin/dreamer screenshot-prefab --asset Assets/X.prefab [--width 512] [--height 512] [--angle iso|front|back|side|right|left|top|bottom] [--background-color "#RRGGBB[AA]"|JSON-rgba] [--transparent] [--save-to PATH]`** — renders a prefab to a PNG using Unity's `PreviewRenderUtility`. Camera auto-frames the prefab's combined mesh bounds (computed from `MeshFilter.sharedMesh.bounds` / `SkinnedMeshRenderer.localBounds` / `Sprite.bounds` and transformed to world-space, NOT from `Renderer.bounds` — the latter is uninitialized for objects in a PreviewScene that haven't rendered yet). Two-light rim setup, configurable background.
- **Custom `--background-color`** accepts hex (`#1a3a8a`, `#1a3a8a80`) or JSON RGB(A) array of 0..1 floats (`[1.0, 0.95, 0.7]`). Default neutral gray.
- **`--transparent` flag** — outputs PNG with full alpha channel (color type 6 / RGBA). Skips PreviewRenderUtility's `BeginStaticPreview`/`EndStaticPreview` (which uses an RGB-only internal RenderTexture and silently drops alpha) in favor of a custom ARGB32 RT bound to the preview camera, then `ReadPixels` into an RGBA32 Texture2D. PNGs are now always RGBA regardless of background opacity, so transparency is ready when you need it.
- Output goes to `Library/DreamerScreenshots/<stem>-<guid8>-<ticks>.png` by default (Library/ is gitignored). Override with `--save-to`.
- Result includes `path`, `boundsCenter`, `boundsSize`, `byteCount`. Open the PNG with the Read tool — Claude Code is multimodal, Read returns the image inline so the agent can see what it built.
- **UI/Canvas prefabs render** — auto-detected for three kinds: (1) prefab has a `Canvas` at root, (2) prefab has a `Canvas` descendant, (3) prefab is a fragment with uGUI components but no Canvas (list items, row entries, slot prefabs, etc). Result includes `mode: "ui"`, camera switches to orthographic, default angle becomes `front`. PreviewRenderUtility's preview scene doesn't tick the Canvas mesh-build pipeline, so UI mode parks the prefab off-screen in the active scene, runs `LayoutRebuilder.ForceRebuildLayoutImmediate` on every RectTransform, dirties every Graphic, then renders via a temporary camera.
- **Canvas-less fragments are now wrapped in a temporary WorldSpace Canvas** automatically. Verified against a real fragment (Button + LayoutElement + child Text): all rendered cleanly. Verified against a complex hand-built UI (TitleBar + Slider + Dropdown + Toggle + Buttons): all widgets render with proper layout.
- **`--size [w,h]` flag** to override the prefab's RectTransform `sizeDelta`. Layout-group-driven prefabs come back at zero or near-zero size when standalone; `--size` lets you force a sensible footprint. When unset: `LayoutElement.preferredWidth/Height` hints win, falling back to 400×100.
- Known limitations:
  - **TextMeshProUGUI text often invisible** — TMP has its own mesh-build pipeline that doesn't tick from `Canvas.ForceUpdateCanvases`. Standard `UnityEngine.UI.Text` works.
  - Logic-only prefabs (no MeshFilter/SkinnedMeshRenderer/SpriteRenderer/Canvas/RectTransform) come back as an empty gray frame; the `boundsSize: [1,1,1]` fallback is the tell.
  - Particles, trails, lines, lights, and post-processing don't contribute to bounds — camera frames static-mesh extent only.

### Fixed — `create-script --path` accepting a `.cs` file path
If `--path` ended in `.cs` (e.g. `Assets/Scripts/Foo/Bar.cs`), Dreamer treated the whole string as a folder, `mkdir`'d `Bar.cs/`, and wrote `Bar.cs/Bar.cs` inside it. Now: a `.cs`-suffixed `--path` is split into parent folder + class name. If `--name` is also given and disagrees with the filename, the command fails fast with a clear message instead of silently nesting.

### Added — PlayerSettings + Build Settings authoring
PlayerSettings fields that go through the static `UnityEditor.PlayerSettings` API (icons, per-platform identifiers, cursor) don't round-trip through the generic SerializedObject editor. Added wrappers:

- **`inspect-player-settings [--target standalone|android|ios|webgl|...]`** — common fields via static API: company/product/version, screen, color space, scripting backend, API compatibility, default cursor + hotspot, default icons, per-platform icons. Default target is `standalone`.
- **`set-app-id --target NAME --id com.foo.bar`** — per-platform application/bundle identifier (`PlayerSettings.SetApplicationIdentifier(NamedBuildTarget, string)`). Targets: standalone, android, ios, webgl, tvos, windowsstore, ps4, ps5, xboxone, switch.
- **`set-default-icon --texture Assets/path.png`** — Default Icon slot (`PlayerSettings.SetIcons(NamedBuildTarget.Unknown, [tex], IconKind.Application)`). Unity scales to all platforms.
- **`set-app-icons --target NAME --textures '[...]'`** — per-platform icon array. Result includes `expectedCount` so you can verify against Unity's required slot count for that target.
- **`set-cursor-icon --texture Assets/path.png [--hotspot [x,y]]`** — Default Cursor + click-point hotspot (`PlayerSettings.defaultCursor` / `cursorHotspot`).

EditorBuildSettings.scenes (the build-scenes list) similarly needs its own command surface — it's a `EditorBuildSettingsScene[]` setter, not a SerializedObject array:
- **`inspect-build-scenes`** — list `{index, path, enabled, guid}` for each scene in the list.
- **`set-build-scenes --scenes JSON`** — replace the whole list. Items are either string paths (enabled by default) or `{path, enabled}`. All scenes must exist on disk.
- **`add-build-scene --scene PATH [--enabled false]`** — append; updates the enabled flag in place if already present.
- **`remove-build-scene --scene PATH`** — remove by path.

For other PlayerSettings fields not yet wrapped (companyName, productName, bundleVersion, defaultScreenWidth, etc.), the existing generic command works: `set-project-setting --file ProjectSettings --property companyName --value '"AnttiCo"'` — the SerializedObject reaches them.

### Added — Project Settings authoring (full coverage)
ProjectSettings/*.asset files live outside Assets/, so the existing `set-property`/`inspect-asset` commands (which use `LoadAssetAtPath`) couldn't reach them. Two layers of new commands address this:

**Phase 1 — first-class wrappers for the common cases:**
- **`inspect-project-settings [--file NAME]`** — overview: 32 layers (with name/builtin flag), tags, sorting layers, 3D + 2D physics summary (gravity + disabled-collision pairs), and a list of every `.asset` in `ProjectSettings/`. With `--file X`: per-field listing for that one file.
- **`set-layer-name --index N --name X [--force]`**, **`clear-layer --index N [--force]`** — name a physics/rendering layer; builtin slots (0-7) require `--force`.
- **`add-tag --name X`**, **`remove-tag --name X`** — TagManager tags (uses `InternalEditorUtility.AddTag`/`RemoveTag`).
- **`add-sorting-layer --name X`**, **`remove-sorting-layer --name X`** — 2D sorting layers (Default is protected).
- **`set-layer-collision --layer-a A --layer-b B [--collide true|false] [--2d]`** — physics layer collision matrix (3D + 2D). Names or numeric indices accepted; matrix is symmetric.
- **`set-physics-gravity --value [x,y,z] [--2d]`** — global gravity. 3D = `Physics.gravity`, 2D = `Physics2D.gravity` (requires `--2d`).

**Phase 2 — generic SerializedObject editor for the long tail:**
- **`set-project-setting --file NAME --property PATH --value JSON`** — edit any field on any `ProjectSettings/*.asset` (PlayerSettings build target overrides, GraphicsSettings, TimeManager, AudioManager, QualitySettings, EditorSettings, …). Same value semantics as `set-property` (arrays, sparse `{_size, N: val}`, asset/scene refs, struct objects). Bracket shorthand `field[N]` is rewritten to `field.Array.data[N]`.
- **`inspect-project-setting --file NAME [--property PATH] [--depth N]`** — inspect a single file's full field listing or drill into a sub-tree.

Discovery flow: `inspect-project-settings` lists files → `inspect-project-setting --file X` lists fields on one → `set-project-setting --file X --property m_Y --value V` edits. No gate; project settings are normal authoring operations.

### Added — `set-play-mode` command + per-machine policy gate
- **`./bin/dreamer set-play-mode --state enter|exit|toggle|pause|unpause|toggle-pause`** — first-class play-mode control via `EditorApplication.EnterPlaymode()` / `ExitPlaymode()` / `isPaused`. Replaces the `execute-menu-item Edit/Play` workaround, which silently failed because Unity's `ExecuteMenuItem` returns false for menu items with validation handlers (Play and Pause among them).
- `execute-menu-item Edit/Play` and `execute-menu-item Edit/Pause` are now auto-routed to the new command on the bridge side, so existing agent code that targeted the menu paths keeps working.
- **Per-machine policy gate** — on first bridge start after this update, the developer is asked once via a Unity dialog whether agents may toggle play mode. Default ON. The choice is stored in EditorPrefs (`Dreamer.AllowPlayModeToggle`) and can be flipped at any time in `Tools > Dreamer` under "Agent Policy". When OFF, all agent attempts (including auto-routed Edit/Play) return a clear "disabled by the project owner" error so agents surface the issue rather than retrying.

### Added — AnimatorController authoring (Animation add-on)
- **`create-animator-controller --name X [--path FOLDER]`** — creates a new `.controller` asset with one default layer.
- **`add-animator-parameter --asset <.controller> --name X --type bool|int|float|trigger [--default V]`** — defines a parameter referenced by transition conditions. Names must be unique.
- **`add-animator-state --asset <.controller> --name X [--motion <.anim>] [--speed N] [--layer N]`** — adds a state with an optional `Motion` clip binding. First state on an empty layer auto-becomes default.
- **`add-animator-transition --asset <.controller> --from STATE --to STATE [--conditions JSON] [--has-exit-time true] [--exit-time N] [--duration N]`** — wires a transition. `--from AnyState` for AnyState transitions, `--to Exit` for exit transitions. Conditions: `{parameter, mode: If|IfNot|Greater|Less|Equals|NotEqual, threshold?}`. Multiple conditions = AND.
- **`set-animator-default-state --asset <.controller> --state X [--layer N]`** — overrides the layer's default state.
- **`inspect-animator-controller --asset <.controller>`** — full controller inspection: parameters, layers, states (with motion paths + speeds), transitions (with conditions).
- v1 scope is state-machine root only. Sub-state machines, blend trees, and per-layer masks are out of scope (author them in the Unity Animator window if needed). `Entry` is not supported as a transition source — use `set-animator-default-state` instead, which Unity treats as the implicit entry connection.

### Added — Sprite curves + Animation events (Animation add-on)
- **`set-sprite-curve --asset <.anim> [--target SUB] [--component TYPENAME] [--property NAME] --keys JSON`** — write/replace an ObjectReferenceCurve for sprite-swap animation. Defaults to `SpriteRenderer.m_Sprite`. Each key: `{ "time": N, "sprite": "path.png" }` or `{ "time": N, "sprite": {"assetRef": "path.png", "subAsset": "Walk_0"} }` for multi-sprite atlas slices.
- **`delete-sprite-curve --asset <.anim> [--target SUB] [--component TYPENAME] [--property NAME]`** — remove a sprite-swap curve.
- **`set-animation-events --asset <.anim> --events JSON`** — replace ALL events on a clip. Each: `{ time, functionName, stringParameter?, floatParameter?, intParameter?, objectReferenceParameter? }`. Pass `[]` to clear.
- `inspect-animation-clip` now also returns `events[]` and per-key sprite info on object-reference bindings.

### Added — Animation add-on (`com.dreamer.agent-bridge.animation`)
- New optional package alongside `com.dreamer.agent-bridge.ugui`. Five new commands for AnimationClip authoring (AnimatorController state-machine commands forthcoming).
- **`create-animation-clip --name X [--path FOLDER] [--frame-rate N] [--loop true|false]`** — creates a new `.anim` asset with the given frameRate (default 30) and loop setting.
- **`set-animation-curve --asset <.anim> [--target SUB] --component <FQN> --property <m_Field.x> --keys '[{...}]'`** — write or replace one float-curve binding. `--target` is relative to the animated GO root (empty = root). Each key: `{ t, v, interp?, inTangent?, outTangent?, inWeight?, outWeight? }`. Supported `interp` modes: `linear`, `constant`, `auto`, `clamped`, `free` (free = use explicit tangent values).
- **`inspect-animation-clip --asset <.anim>`** — list all curve bindings with per-curve summary (keyCount, time/value range). Object-reference bindings are listed but not editable in v1.
- **`sample-animation-curve --asset <.anim> [--target SUB] --component <FQN> --property <m_Field.x> [--samples 30] [--t-start N] [--t-end N]`** — evaluate one curve at N evenly-spaced times and return `[{t, v}, ...]`. **The agent's primary tool for verifying curves numerically** — read back after every set-animation-curve to catch tangent surprises and overshoot.
- **`delete-animation-curve --asset <.anim> [--target SUB] --component <FQN> --property <m_Field.x>`** — remove one binding by triple.
- Add-on plugin discovery: same reflection-based pattern as the ugui add-on. If the package isn't installed, dispatcher returns "Unknown command kind" and the schema docs hint at the install command.

### Added — `set-particle-property` command
- New first-class command: `./bin/dreamer set-particle-property (--scene-object PATH | --asset PATH [--child-path SUB]) --property MODULE.FIELD --value JSON`. Reaches ParticleSystem module fields (`main.startLifetime`, `emission.rateOverTime`, `shape.angle`, `noise.strength`, etc.) that the generic `set-property` couldn't touch — modules are exposed via wrapper-struct property accessors, not direct serialized fields, and the underlying serialized names also don't match the API (`main` → `InitialModule`, `limitVelocityOverLifetime` → `ClampVelocityModule`, `textureSheetAnimation` → `UVModule`, …). The handler does the API-name → serialized-name rewrite for the 23 known modules.
- MinMaxCurve scalar shorthand: a bare number (`--value 5`) auto-sets `scalar` + `minScalar` + `minMaxState=Constant`. `{"min":N,"max":M}` sets TwoConstants mode. For curve-mode (animated over particle lifetime), drill into sub-fields explicitly: `main.startLifetime.scalar`, `.minMaxState`, `.maxCurve`.

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
