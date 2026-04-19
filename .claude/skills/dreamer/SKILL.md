---
name: dreamer
description: Drive the ./bin/dreamer CLI to automate Unity Editor operations in this project — create scripts, prefabs, components, scene objects; set serialized properties (including struct arrays and self-references); inspect assets and hierarchies; manage compile gating and focus. Use whenever the task involves modifying the Unity project in this repo.
---

# Dreamer — Unity Editor Automation

Use the project-local `dreamer` CLI to automate Unity Editor operations. Invoke every command as `./bin/dreamer <command>` from the Unity project root (POSIX/bash). On Windows cmd/PowerShell, use `.\bin\dreamer <command>`. Do not call a global `dreamer` — this tool is intentionally project-local; each Unity project has its own independent install.

The daemon auto-starts on the first invocation and Unity must have the Dreamer package loaded.

## Workflow

1. **Check status**: `./bin/dreamer status` — verify Unity is connected
2. **Discover**: `./bin/dreamer find-assets`, `./bin/dreamer inspect`, `./bin/dreamer inspect-hierarchy`
3. **Create**: scripts → prefabs → components → properties → scene instances
4. **Always use `--wait`** for mutation commands so you know the result before proceeding

## Writing Scripts Externally

When you write .cs files directly to disk (not via `./bin/dreamer create-script`):
```bash
# After writing files, tell Unity to detect them
./bin/dreamer refresh-assets --wait
# Then wait for compilation to finish before using new types
./bin/dreamer compile-status
```

## Key Commands

```bash
# Discovery
./bin/dreamer find-assets --type prefab --name "Player*"
./bin/dreamer inspect "Assets/Prefabs/Player.prefab" --wait
./bin/dreamer inspect-hierarchy --wait

# Create script (triggers AssetDatabase.Refresh inside Unity)
./bin/dreamer create-script --name MyComponent --namespace Game --path "Assets/Scripts" --wait

# Create prefab
./bin/dreamer create-prefab --name MyPrefab --path "Assets/Prefabs" --wait

# Add component (auto-waits for compilation)
./bin/dreamer add-component --asset "Assets/Prefabs/MyPrefab.prefab" --type "Game.MyComponent" --wait

# Set primitive properties
./bin/dreamer set-property --asset "Assets/Prefabs/MyPrefab.prefab" --component "Game.MyComponent" --property "speed" --value "10" --wait

# Set prefab reference (public GameObject field)
./bin/dreamer set-property --asset "Assets/Prefabs/A.prefab" --component "Game.MyComponent" --property "targetPrefab" --value '{"assetRef":"Assets/Prefabs/B.prefab"}' --wait

# Set typed component reference (public Rigidbody field → auto-resolves component from prefab)
./bin/dreamer set-property --asset "Assets/Prefabs/A.prefab" --component "Game.MyComponent" --property "targetBody" --value '{"assetRef":"Assets/Prefabs/B.prefab"}' --wait

# Instantiate prefab into scene
./bin/dreamer instantiate-prefab --asset "Assets/Prefabs/MyPrefab.prefab" --position '{"x":0,"y":1,"z":0}' --wait

# Set scene object reference (e.g., assign Main Camera to a Camera field on a scene instance)
./bin/dreamer set-property --scene-object "MyPrefab" --component "Game.MyComponent" --property "mainCamera" --value '{"sceneRef":"Main Camera"}' --wait

# Refresh (after writing files to disk externally)
./bin/dreamer refresh-assets --wait

# Save
./bin/dreamer save-assets --wait

# Status
./bin/dreamer status
./bin/dreamer compile-status
./bin/dreamer console --count 20
./bin/dreamer queue --state waiting

# Self-update (pulls latest from the repo recorded at install time)
./bin/dreamer update            # updates to the ref stored in daemon/.dreamer-source.json (usually main)
./bin/dreamer update --ref v0.3.0
./bin/dreamer update --dry-run  # show what would change without writing

# Probe for a free port (useful when setting up a second Unity project on the same machine)
./bin/dreamer probe-port                    # returns first free port in [18710, 18719]
./bin/dreamer probe-port --start 19000 --count 20

# Arg schema for a documented command kind (no-arg call lists documented kinds)
./bin/dreamer help
./bin/dreamer help add_component
```

## Command Schemas

Some command kinds have machine-readable arg schemas (type, required, enum, cross-field constraints). When present, the daemon validates args on submit and returns structured errors listing what was wrong. Run `./bin/dreamer help` to list which kinds are documented, and `./bin/dreamer help <kind>` to see the full arg spec and examples before constructing a call. Undocumented kinds still work — they just lack formal arg docs.

## Updating Dreamer

When the user asks to update Dreamer (e.g. "update Dreamer", "pull the latest Dreamer"):

1. Run `./bin/dreamer update`. It clones the recorded repo shallowly, stops the daemon, and replaces `daemon/src`, `daemon/bin`, `daemon/package.json`, `Packages/com.dreamer.agent-bridge/`, `.claude/skills/dreamer/SKILL.md`, and the `bin/dreamer` / `bin/dreamer.cmd` wrappers. `daemon/.dreamer-config.json`, `daemon/.dreamer-source.json`, and queue state are preserved. A one-time migration also removes the legacy `.claude/commands/dreamer.md` if present.
2. Report the new commit SHA from the output.
3. Tell the user Unity may reimport the package briefly. Run `./bin/dreamer status` to confirm the daemon restarted and Unity is still connected.
4. If the CLI fails with "No daemon/.dreamer-source.json", the install pre-dates self-update — tell the user to rerun the installer.

## Object Reference Values

```bash
# Asset reference (prefab, material, etc.)
--value '{"assetRef":"Assets/Prefabs/Enemy.prefab"}'

# Scene object reference
--value '{"sceneRef":"Main Camera"}'

# Clear reference
--value "null"
```

Typed fields (e.g., `public Rigidbody rb`, `public Camera cam`) auto-resolve: point to a prefab or scene object and Dreamer finds the matching component.

## Property Names for Built-in Unity Components

Unity's built-in components (`Transform`, `SpriteRenderer`, `Collider`, `Camera`, etc.) serialize fields as `m_Pascal` (e.g. `m_Sprite`, `m_LocalPosition`). Dreamer automatically accepts the C#-style camelCase form — `sprite`, `localPosition`, `color`, `isTrigger` — and falls back to `m_Sprite` etc. on lookup failure. User-defined `[SerializeField]` fields keep their declared name as-is. The result JSON includes `resolvedPath` so you can see which form Unity actually used.

## Array / Struct / Self-Reference Property Values

`set-property` handles composite values beyond primitives and object refs:

```bash
# Array / list — resize + assign all elements
--value '[1, 2, 3]'
--value '[{"field":1,"other":"x"}, {"field":2,"other":"y"}]'   # struct array

# Sparse / size-only array updates
--value '{"_size":4,"0":{"field":1},"3":{"field":9}}'          # resize + two indices

# Nested struct (leaves unmentioned fields untouched)
--value '{"field":42,"nested":{"inner":"ok"}}'

# Sibling component on the same GameObject (for self-references in a prefab/scene object)
--value '{"self":true,"component":"PlayerController"}'

# Descendant of the currently-edited prefab/scene object
--value '{"selfChild":"Visuals/Hand","component":"SpriteRenderer"}'
```

## Scene Object Path Rules (`--scene-object`, `sceneRef`)

- `"/Root/Child/Grandchild"` — absolute: first segment MUST be a root-level object. No fallback.
- `"Root/Child"` — same as absolute (first segment is a root name). One match required.
- `"Grandchild"` — bare name: recursive search across **all loaded scenes** (active + additive). Returns an error if the name is ambiguous, listing every matching path so you can qualify it.
- `"Parent/Grandchild"` — bare prefix: recursive search anywhere that chain matches.

Ambiguity is an error, not a silent misroute. On collision, the CLI fails with matching paths so you can pick one.

## `create-hierarchy` Result Warnings

When `create-hierarchy --json ...` can't add a requested component (unknown type, not-a-component, duplicate), it records the reason into a `warnings` array in the result JSON rather than dropping silently. The most common cause: the user type was declared in a script that has a current compile error, so `ResolveType` returned null. Check `./bin/dreamer compile-status` before calling `create-hierarchy` with custom types, and inspect `warnings[]` in the response afterward.

## Workflows: writing / editing C# scripts

The daemon runs an asset watcher on `Assets/**/*.{cs,asmdef,asmref}`. When you run a compile-gated command (`add-component`, `set-property`, `create-prefab`, etc.) and there have been `.cs` changes since the last refresh, the CLI automatically prepends `refresh-assets --wait` before submitting. You don't need to manage this — just write files and run commands.

| Path | What happens |
|---|---|
| `./bin/dreamer create-script` | Asset pipeline handles everything end-to-end. |
| Direct write (any tool) + compile-gated command | CLI sees the watcher's dirty flag, auto-refreshes, then runs your command. ✓ |
| Direct write then `./bin/dreamer refresh-assets --wait` manually | Also fine — the auto-refresh sees clean state and is a no-op. |
| Direct write while Unity is minimized | Auto-refresh triggers the import; Unity compiles as part of dispatching the refresh, then the command runs. ✓ |

Opt-outs if needed:
- `--no-refresh` on an individual command — skip the auto-refresh.
- `./bin/dreamer config set autoRefresh=false` — global opt-out.

Check watcher state any time: `./bin/dreamer status` includes an `assets: { active, dirty, lastChangedFile }` block.

## CRITICAL: Reading `compile-status` correctly

The `/api/compile-status` response has a **synthesized `status` field**. Read that. Trust its `summary`. Do NOT compute your own verdict from `errors` / `lastSuccess` / `compiling` — that's exactly how agents end up in a "force-compile, check timestamp, retry" loop for minutes.

`status` values and what they mean:

| status | ready | what to do |
|---|---|---|
| `ok` | true | Compile is clean. Proceed. |
| `idle` | true | Connected, no errors, but no compile observed yet this daemon session. If you just wrote `.cs`, run `refresh-assets --wait`. Otherwise proceed. |
| `stale` | false | You edited assets AFTER the last clean compile. `errors:[]` is lying. Run `refresh-assets --wait` + `focus-unity` on Windows. |
| `errors` | false | Real compile errors. `summary` lists the first three. Fix the code. |
| `compiling` | false | Unity is compiling right now. Wait. |
| `unknown` | false | Bridge connected but hasn't reported compile state yet. Wait briefly. |
| `disconnected` | false | Unity bridge isn't connected. Start/focus Unity. |

**Stopping rule**: if you've called `refresh-assets --wait` + `focus-unity` twice in a row and `status` hasn't changed, STOP retrying. Something is structurally wrong (Unity Auto Refresh disabled in Preferences, a file stuck with the wrong importer, a syntax error preventing parse). Ask the user — don't loop.

## Failure Mode: Script stuck as "unknown type" (can't be assigned to prefabs)

**Symptom**: you wrote `Assets/Foo.cs` directly to disk, `refresh-assets` ran, `compile-status` shows `ok` — but the class isn't in `Assembly-CSharp.dll`, `add-component` fails with "Type not found", and in Unity you can't drag the script onto a GameObject because the MonoScript subasset doesn't exist.

**Root cause**: Unity imported the file via `DefaultImporter` (unknown asset type) instead of `MonoImporter`. Happens when a `.cs` write lands while the Editor is unfocused on Windows. Subsequent refreshes compare hashes, see no change, and skip re-import — the file stays stuck.

**Auto-heal**: `refresh-assets` now checks every `.cs` file the watcher flagged as changed, and force-reimports any that Unity didn't classify as `MonoScript`. Result JSON includes:
- `reimported: [...]` — paths that were healed
- `misclassified: [...]` — paths still stuck after force-reimport (needs manual look — usually a syntax error preventing parse, or a filename/classname mismatch)

**Manual rescue** (use when auto-heal didn't catch it, or the file wasn't in the watcher):
```bash
./bin/dreamer reimport-script --path Assets/Foo.cs --wait
./bin/dreamer reimport-script --path Assets/Scripts --wait    # whole folder, recursive
./bin/dreamer reimport-script --path Assets/Scripts --non-recursive --wait
```
Force-reimports every `.cs` under the path regardless of current classification, then kicks `CompilationPipeline.RequestScriptCompilation()`. Response includes `healed`, `reimported`, `misclassified` lists.

## Failure Mode: Stale Asset DB (Type / Property not found)

The auto-refresh usually prevents this, but it can still appear if the watcher missed an event, you passed `--no-refresh`, or Unity's import silently failed. When a command fails with `"Type not found: X"` or `"Property 'X' not found on 'Y'"`, the CLI detects this pattern and appends a hint:

```json
{
  "error": "Type not found: …",
  "hint": "This error usually means Unity has not imported recent .cs changes. …"
}
```
Exit code 1. Remediation: run `./bin/dreamer refresh-assets --wait`, then `./bin/dreamer compile-status` (to confirm no compile errors), then retry.

## Failure Mode: Unity Compile Errors

When Unity has compile errors, commands that need compiled types (`add_component`, `remove_component`, `create_script`, etc.) can't proceed. The daemon gates them with `waitingReason: "Compile errors present"`. If you use `--wait`, the CLI detects this and short-circuits immediately — you don't have to wait out the timeout — returning:

```json
{
  "error": "Cannot proceed: Unity has compile errors",
  "commandId": "...",
  "kind": "add_component",
  "waitingReason": "Compile errors present",
  "compileErrors": ["Assets/…cs(5,21): error CS1002: ; expected", …],
  "hint": "Fix the scripts … then re-run."
}
```
Exit code is 1. When you see this, fix the scripts, run `./bin/dreamer refresh-assets --wait`, confirm `./bin/dreamer compile-status` shows no errors, then retry the original command. Unity must be focused to actually run compilation — if `compile-status` seems frozen, `./bin/dreamer focus-unity` forces a tick.

## Important Notes

- Commands that need compiled types (`add_component`, `remove_component`) auto-wait for compilation
- Use `--scene-object "ObjectName"` instead of `--asset` to target scene instances
- Inspect before mutating — verify asset paths and component types exist
- After creating scripts, wait for compilation before adding them as components
- Unity's main thread stops ticking entirely when unfocused on Windows (for most Editor work — not "slowly", stops). So focus matters when, and only when, commands stall.
- Default focus policy is `smart`: never focus upfront. If `--wait` is set and the command hasn't reached a terminal state after 5 s, the CLI focuses Unity once to unstick it. Tune with `--focus-after MS` or set `focusStallMs` in `daemon/.dreamer-config.json`.
- Use `--focus` to force upfront focus, `--no-focus` to suppress all focus (including the stall fallback).
- Switch modes globally: `./bin/dreamer config set autoFocus=always` (or `smart` / `never`).
