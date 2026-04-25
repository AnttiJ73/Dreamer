---
name: dreamer
description: Automate Unity Editor operations — find, create, and modify prefabs, components, scripts, scene objects, and materials. Use when the task involves creating assets, editing serialized properties, managing GameObjects (delete / rename / reparent / duplicate), wiring component or asset references, inspecting hierarchies, or controlling compile state. Default to the dreamer CLI for any asset/scene mutation in this project; do NOT hand-edit `.unity`, `.prefab`, `.asset`, or `.meta` YAML.
---

# Dreamer — Unity Editor Automation

Project-local CLI: `./bin/dreamer <command>` from the Unity project root (POSIX/bash). On Windows cmd/PowerShell use `.\bin\dreamer <command>`. The daemon auto-starts on first invocation; Unity must have the Dreamer package loaded. Don't call a global `dreamer` — every Unity project has its own install.

## Cheat sheet

```bash
# Discover
./bin/dreamer find-assets --type prefab --name "Player*"
./bin/dreamer inspect "Assets/Prefabs/Player.prefab" --wait
./bin/dreamer inspect-hierarchy --wait

# Create / wire
./bin/dreamer create-script   --name PlayerCtl --namespace Game --path Assets/Scripts --wait
./bin/dreamer create-prefab   --name Player --path Assets/Prefabs --wait
./bin/dreamer add-component   --asset Assets/Prefabs/Player.prefab --type "Game.PlayerCtl" --wait
./bin/dreamer set-property    --asset Assets/Prefabs/Player.prefab --component "Game.PlayerCtl" --property speed --value 5 --wait

# Asset/scene/sub-asset references — see property-values.md for full syntax
./bin/dreamer set-property --asset A.prefab --component X --property target --value '{"assetRef":"Assets/B.prefab"}' --wait
./bin/dreamer set-property --scene-object Player --component X --property cam --value '{"sceneRef":"Main Camera"}' --wait

# Scene GameObject editing — by scene path. NEVER use set-property on m_Name (errors).
./bin/dreamer instantiate-prefab --asset Assets/Prefabs/Player.prefab --position '{"x":0,"y":1,"z":0}' --wait
./bin/dreamer rename             --scene-object "/UICanvas/TempName" --name FinalName --wait
./bin/dreamer reparent           --scene-object "/Visuals/SpriteHolder" --new-parent "/Body" --wait
./bin/dreamer reparent           --scene-object "/Body/Stray" --wait                       # → moves to scene root
./bin/dreamer duplicate          --scene-object "/Spawn/Pickup" --wait
./bin/dreamer delete-gameobject  --scene-object "/UICanvas/OldPanel" --wait

# Editing prefab assets at depth — use --child-path on add/remove/set-property/reparent
./bin/dreamer add-component --asset Assets/Prefabs/Enemy.prefab --child-path "Visuals/Body" --type UnityEngine.SpriteRenderer --wait
./bin/dreamer set-property  --asset Assets/Prefabs/Enemy.prefab --child-path "Visuals/Body" --component SpriteRenderer --property color --value '{"r":1,"g":0,"b":0,"a":1}' --wait
./bin/dreamer reparent      --asset Assets/Prefabs/Enemy.prefab --child-path "Visuals/Body" --new-parent "Bones/Root" --wait

# Persist + status
./bin/dreamer save-assets --wait        # writes BOTH dirty open scenes AND ScriptableObjects/prefabs/materials
./bin/dreamer refresh-assets --wait     # only needed if you wrote .cs externally and didn't run a compile-gated command
./bin/dreamer status
./bin/dreamer compile-status
./bin/dreamer console --count 20
./bin/dreamer activity --since 2m       # multi-agent visibility — what other Claude sessions did recently
./bin/dreamer help                      # list documented kinds
./bin/dreamer help add_component        # arg schema for one kind

# Canvas UI — see dreamer-ugui skill (auto-loads when UI keywords appear)
```

**Reference companions** — load these only when you need their topic, not every session:
- [property-values.md](property-values.md) — `--value` format catalogue: arrays, structs, sub-asset references, `entries[N]` syntax, scene path rules, `m_Name` redirect.
- [materials-shaders.md](materials-shaders.md) — `create-material`, `inspect-material`, `set-material-property` (incl. shader keywords), `set-material-shader`, `shader-status`, `inspect-shader`.

## Workflow

1. **Check status**: `./bin/dreamer status` — verify Unity is connected.
2. **Discover**: `find-assets`, `inspect`, `inspect-hierarchy`.
3. **Create**: scripts → prefabs → components → properties → scene instances.
4. **Always pass `--wait`** for mutation commands so you see the result before proceeding.
5. **Persist**: `./bin/dreamer save-assets --wait` after scene-object mutations (it writes both scenes and assets).

## Writing scripts externally

When you write `.cs` files directly to disk (not via `create-script`), the daemon's asset watcher sees the change and the next compile-gated command (`add-component`, `set-property`, `create-prefab`, etc.) auto-prepends `refresh-assets`. You don't need to manage this — just write files and run commands.

If you only wrote scripts and don't immediately have a follow-up command, force the import yourself:

```bash
./bin/dreamer refresh-assets --wait
./bin/dreamer compile-status      # verify clean before assigning the type to anything
```

| Path | Behaviour |
|---|---|
| `./bin/dreamer create-script` | End-to-end: write + import + compile happen inside Unity. |
| Direct write + compile-gated command | CLI auto-refreshes via the dirty flag, then runs your command. |
| Direct write + manual `refresh-assets` | Watcher sees clean state and the auto-refresh is a no-op. |
| Direct write while Unity unfocused on Windows | Refresh dispatches the import on focus; command then runs. |

Opt-outs: `--no-refresh` per-command, or `./bin/dreamer config set autoRefresh=false` globally.

## `create-hierarchy` warnings

When `create-hierarchy --json ...` can't add a requested component (unknown type, not-a-component, duplicate), it records the reason in a `warnings[]` array in the result rather than dropping silently. Most common cause: the user type was declared in a script with a current compile error, so `ResolveType` returned null. Check `compile-status` before calling `create-hierarchy` with custom types, and inspect `warnings[]` afterward.

## Reading `compile-status`

The `/api/compile-status` response has a **synthesized `status` field**. Read that. Trust its `summary`. Do NOT compute your own verdict from `errors` / `lastSuccess` / `compiling` — that's the path to "force-compile, check timestamp, retry" loops.

| status | ready | what to do |
|---|---|---|
| `ok` | true | Compile is clean. Proceed. |
| `idle` | true | Connected, no errors, but no compile observed yet this daemon session. If you just wrote `.cs`, run `refresh-assets --wait`. Otherwise proceed. |
| `stale` | false | You edited assets after the last clean compile. `errors:[]` is lying. Run `refresh-assets --wait` (+ `focus-unity` on Windows). |
| `errors` | false | Real compile errors. `summary` lists the first three. Fix the code. |
| `compiling` | false | Unity is compiling right now. Wait. |
| `unknown` | false | Bridge connected but hasn't reported compile state yet. Wait briefly. |
| `disconnected` | false | Unity bridge isn't connected. Start/focus Unity. |

**Stopping rule**: if `refresh-assets --wait` + `focus-unity` twice in a row hasn't changed `status`, STOP retrying. Something is structurally wrong (Auto Refresh disabled, file stuck on wrong importer, syntax error preventing parse). Ask the user — don't loop.

## Play Mode gating

When Unity is in Play Mode, scene edits revert when Play Mode exits — only EditMode changes persist to disk. To prevent edits that look successful but silently vanish, Dreamer holds scene-edit commands in `waiting` state with:

> `Play Mode active — scene edits would be lost on exit. Stop Play Mode in Unity (or submit with --allow-playmode to override).`

Gated kinds: `create-gameobject`, `instantiate-prefab`, `create-hierarchy` (scene mode, no `--save-path`), and any of `delete-gameobject` / `rename` / `reparent` / `duplicate` / `set-property` / `add-component` / `remove-component` / `remove-missing-scripts` when targeting a scene object via `--scene-object`.

NOT gated (these persist fine in Play Mode): all asset-target variants, `create-prefab`, `create-script`, `create-material`, scene file save/open, `find-assets`, `inspect-*`, `compile-status`, `activity`, `console`.

Override with `--allow-playmode` per-command. Normal path: stop Play Mode in Unity and let queued commands dispatch.

## Failure modes

### Script stuck as "unknown type" (can't be assigned to prefabs)

**Symptom**: you wrote `Assets/Foo.cs`, `refresh-assets` ran, `compile-status` shows `ok` — but the class isn't in `Assembly-CSharp.dll`, `add-component` fails with "Type not found", and Unity won't let you drag the script onto a GameObject.

**Root cause**: Unity imported the file via `DefaultImporter` (unknown asset type) instead of `MonoImporter`. Happens when a `.cs` write lands while the Editor is unfocused on Windows. Subsequent refreshes compare hashes, see no change, and skip re-import — the file stays stuck.

**Auto-heal**: `refresh-assets` checks every `.cs` file the watcher flagged as changed and force-reimports any Unity didn't classify as `MonoScript`. Result JSON includes `reimported[]` and `misclassified[]` (still stuck after force-reimport — usually a syntax error or filename/classname mismatch).

**Manual rescue** (if auto-heal didn't catch it):
```bash
./bin/dreamer reimport-script --path Assets/Foo.cs --wait
./bin/dreamer reimport-script --path Assets/Scripts --wait    # whole folder
./bin/dreamer reimport-script --path Assets/Scripts --non-recursive --wait
```

### Stale Asset DB ("Type not found" / "Property not found")

The auto-refresh usually prevents this, but if the watcher missed an event, you passed `--no-refresh`, or Unity's import silently failed, commands fail with `Type not found: X` or `Property 'X' not found on 'Y'`. The CLI detects this pattern and adds a `hint` field. Remediation: `refresh-assets --wait`, then `compile-status` (confirm clean), then retry.

### Compile errors block compile-gated commands

When Unity has compile errors, commands needing compiled types (`add_component`, `remove_component`, `create_script`, etc.) gate with `waitingReason: "Compile errors present"`. If you used `--wait`, the CLI short-circuits immediately rather than timing out, returning the error list. Fix the scripts, `refresh-assets --wait`, confirm `compile-status` is clean, retry. Unity must be focused to compile — if `compile-status` seems frozen, `./bin/dreamer focus-unity` forces a tick.

## Parallel agent sessions on the same Unity project

Dreamer doesn't enforce coordination between multiple agents driving the same project. If you're one of several Claude sessions:

- **Always pass `--label "<agent-id>:<task>"`** on every mutation. Example: `--label "sessionB:player-setup"`. The label lands in `status`, `queue`, and `activity`.
- **Before drawing conclusions about compile errors / scene state / missing types**, run `./bin/dreamer activity --since 2m`. Recent commands with their labels — if another agent just wrote scripts 30 seconds ago, that's probably the cause of the errors you're seeing, not your own changes.
- **Don't revert your own work based on an error you didn't clearly cause.** Check `activity` first. If another agent is mid-edit, wait or work on something unrelated.

No explicit locking exists. Expect occasional conflicts. Commands are atomic individually; cross-command races are on you. Recovery: `activity` + `git log` + `git diff`.

## Canvas UI building (optional add-on)

For any uGUI (Canvas) work — menus, HUDs, panels, buttons, scroll views, dropdowns, sliders — DEFAULT to the `dreamer-ugui` skill (auto-loads when the task mentions UI). Don't write Canvas UI in C# unless explicitly asked.

If `create-ui-tree` returns "Unknown command kind: create_ui_tree", the add-on isn't installed. Tell the user:
> To enable UI building commands, run: `./bin/dreamer addon install ugui`

No UI commands ship in core Dreamer by design — the UGUI surface is large and only relevant for a subset of Unity work.

## Updating Dreamer

When asked to update (e.g. "update Dreamer", "pull the latest"):

1. Run `./bin/dreamer update`. Clones the recorded repo shallowly, stops the daemon, replaces `daemon/src`, `daemon/bin`, `daemon/package.json`, `Packages/com.dreamer.agent-bridge/`, `.claude/skills/dreamer/SKILL.md`, and the `bin/dreamer` / `bin/dreamer.cmd` wrappers. `daemon/.dreamer-config.json`, `daemon/.dreamer-source.json`, and queue state are preserved.
2. Report the new commit SHA from the output.
3. Tell the user Unity may reimport the package briefly. Run `./bin/dreamer status` to confirm the daemon restarted and Unity is still connected.
4. If the CLI fails with "No daemon/.dreamer-source.json", the install pre-dates self-update — tell the user to rerun the installer.

## Self-update / port utilities

```bash
./bin/dreamer update                        # to the ref recorded at install time (usually main)
./bin/dreamer update --ref v0.3.0
./bin/dreamer update --dry-run              # show what would change
./bin/dreamer probe-port                    # first free port in [18710, 18719]
./bin/dreamer probe-port --start 19000 --count 20
```

## Important notes

- Commands needing compiled types (`add_component`, `remove_component`) auto-wait for compilation.
- Use `--scene-object PATH` for scene instances; `--asset PATH` for prefab/material/SO assets.
- Inspect before mutating — verify asset paths and component types exist.
- Unity's main thread STOPS when unfocused on Windows. The CLI's default `smart` focus policy auto-focuses Unity once if a `--wait` command stalls past 5s. Tune via `--focus-after MS` or set `focusStallMs` in `daemon/.dreamer-config.json`.
- Force focus upfront: `--focus`. Suppress all focus (incl. stall fallback): `--no-focus`. Globally: `./bin/dreamer config set autoFocus=always | smart | never`.
