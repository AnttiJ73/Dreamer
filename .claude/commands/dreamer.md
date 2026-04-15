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
```

## Updating Dreamer

When the user asks to update Dreamer (e.g. "update Dreamer", "pull the latest Dreamer"):

1. Run `./bin/dreamer update`. It clones the recorded repo shallowly, stops the daemon, and replaces `daemon/src`, `daemon/bin`, `daemon/package.json`, `Packages/com.dreamer.agent-bridge/`, `.claude/commands/dreamer.md`, and the `bin/dreamer` / `bin/dreamer.cmd` wrappers. `daemon/.dreamer-config.json`, `daemon/.dreamer-source.json`, and queue state are preserved.
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

## Important Notes

- Commands that need compiled types (`add_component`, `remove_component`) auto-wait for compilation
- Use `--scene-object "ObjectName"` instead of `--asset` to target scene instances
- Inspect before mutating — verify asset paths and component types exist
- After creating scripts, wait for compilation before adding them as components
- Unity must be focused for commands to execute (CLI auto-focuses by default)
- Use `--no-focus` to queue commands without stealing focus
