# Dreamer

Unity Editor automation bridge for LLM agents. Lets Claude (or any agent) create scripts, prefabs, components, set properties, instantiate into scenes, and wire up references — all through a simple CLI.

The agent doesn't need to understand Unity's compilation lifecycle, domain reloads, or asset refresh timing. Dreamer handles all of that.

## How it works

```
Agent (Claude) → CLI (dreamer) → Daemon (localhost:18710) ← Unity Editor (polling)
```

- **CLI** — Simple commands the agent calls (`dreamer create-prefab`, `dreamer add-component`, etc.)
- **Daemon** — Persistent Node.js process that queues commands and waits for Unity to be ready
- **Unity Package** — Editor-side bridge that polls for commands and executes them inside Unity

Commands that depend on compilation (like adding a newly created component) automatically wait until Unity finishes compiling. The agent just submits commands and they execute when safe.

## Prerequisites

- **Unity 6** (6000.0+)
- **Node.js 18+**

## Installation

### 1. Unity Package

In your Unity project, open `Window > Package Manager`, click `+`, choose **Add package from git URL**, and enter:

```
https://github.com/AnttiJ73/Dreamer.git?path=Packages/com.dreamer.agent-bridge
```

The bridge activates automatically. Toggle it via `Tools > Dreamer > Toggle Agent Bridge`.

### 2. Daemon + CLI

```bash
# Clone the repo (or just the daemon directory)
git clone https://github.com/AnttiJ73/Dreamer.git

# Install the CLI globally
cd Dreamer/daemon
npm link
```

This makes the `dreamer` command available globally. The daemon auto-starts when you run any command.

### 3. Verify

With Unity open and the package installed:

```bash
dreamer status
```

You should see `"connected": true`.

## Quick Start

```bash
# Find all prefabs in the project
dreamer find-assets --type prefab

# Create a new script
dreamer create-script --name PlayerController --namespace Game --path "Assets/Scripts"

# If you wrote scripts to disk externally (not via create-script), refresh Unity
dreamer refresh-assets --wait

# Create a prefab
dreamer create-prefab --name Player --path "Assets/Prefabs" --wait

# Add a component (auto-waits for compilation if needed)
dreamer add-component --asset "Assets/Prefabs/Player.prefab" --type "Game.PlayerController" --wait

# Set a property
dreamer set-property --asset "Assets/Prefabs/Player.prefab" --component "Game.PlayerController" --property "speed" --value "10" --wait

# Set a prefab reference field (e.g., public GameObject enemyPrefab)
dreamer set-property --asset "Assets/Prefabs/Player.prefab" --component "Game.PlayerController" --property "enemyPrefab" --value '{"assetRef":"Assets/Prefabs/Enemy.prefab"}' --wait

# Set a typed component reference (e.g., public Rigidbody targetBody)
# Automatically resolves to the Rigidbody component on the target prefab
dreamer set-property --asset "Assets/Prefabs/Player.prefab" --component "Game.PlayerController" --property "targetBody" --value '{"assetRef":"Assets/Prefabs/Enemy.prefab"}' --wait

# Instantiate a prefab into the scene
dreamer instantiate-prefab --asset "Assets/Prefabs/Player.prefab" --position '{"x":0,"y":1,"z":0}' --wait

# Set a scene object reference (e.g., assign Main Camera to a Camera field)
dreamer set-property --scene-object "Player" --component "Game.PlayerController" --property "mainCamera" --value '{"sceneRef":"Main Camera"}' --wait

# Inspect what's on a prefab
dreamer inspect "Assets/Prefabs/Player.prefab" --wait

# View scene hierarchy
dreamer inspect-hierarchy --wait

# Save everything
dreamer save-assets --wait
```

## Command Reference

### Asset Discovery
| Command | Description |
|---------|-------------|
| `dreamer find-assets [--type TYPE] [--name PATTERN] [--path FOLDER]` | Search assets. Types: prefab, script, scene, material, texture |
| `dreamer inspect <path-or-guid>` | Detailed info about an asset (components, fields, children) |
| `dreamer inspect-hierarchy [--scene NAME]` | Scene hierarchy with components |

### Creation & Mutation
| Command | Description |
|---------|-------------|
| `dreamer create-script --name NAME [--namespace NS] [--template TYPE] [--path FOLDER]` | Create a C# script. Templates: monobehaviour, scriptableobject, editor, plain |
| `dreamer create-prefab --name NAME [--path FOLDER]` | Create an empty prefab |
| `dreamer add-component --asset PATH --type TYPENAME` | Add a component to a prefab |
| `dreamer remove-component --asset PATH --type TYPENAME` | Remove a component |
| `dreamer set-property --asset PATH --component TYPE --property FIELD --value JSON` | Set any property (primitives, vectors, colors, object references) |
| `dreamer set-property --scene-object PATH --component TYPE --property FIELD --value JSON` | Set property on a scene object instance |
| `dreamer instantiate-prefab --asset PATH [--position JSON] [--name NAME]` | Add a prefab instance to the scene |
| `dreamer create-gameobject --name NAME [--parent PATH]` | Create an empty GameObject in the scene |

### Object References

The `--value` for object reference fields uses special syntax:

```bash
# Asset reference (prefab, material, etc.)
--value '{"assetRef":"Assets/Prefabs/Enemy.prefab"}'

# Scene object reference
--value '{"sceneRef":"Main Camera"}'

# By GUID
--value '{"guid":"abc123..."}'

# Clear a reference
--value "null"
```

Typed component references (e.g., `public Rigidbody rb`) auto-resolve — if you point to a prefab, Dreamer finds the matching component on it.

### Status & Diagnostics
| Command | Description |
|---------|-------------|
| `dreamer status` | Daemon + Unity connection status |
| `dreamer compile-status` | Is Unity compiling? Any errors? |
| `dreamer console [--count N]` | Recent Unity console entries |
| `dreamer queue [--state STATE]` | View queued/running/completed commands |
| `dreamer refresh-assets` | Force Unity to detect file changes on disk |
| `dreamer save-assets` | Save all modified assets |

### Daemon Management
| Command | Description |
|---------|-------------|
| `dreamer daemon start` | Explicitly start the daemon |
| `dreamer daemon stop` | Stop the daemon |
| `dreamer daemon status` | Check if daemon is running |
| `dreamer focus-unity` | Bring Unity window to foreground |

### Flags

All mutation commands support:
- `--wait` — Block until the command completes (recommended for scripts)
- `--wait-timeout MS` — Max wait time (default: 120000ms)
- `--depends-on CMD_ID` — Don't execute until another command succeeds
- `--no-focus` — Don't auto-focus Unity window

## How the Scheduling Works

When you submit a command, the daemon decides when it's safe to execute:

1. **No requirements** (find-assets, inspect, create-prefab) → dispatched immediately
2. **Requires compilation** (add-component, remove-component) → waits until Unity reports no compile errors
3. **Has dependency** (--depends-on) → waits until the dependency succeeds
4. **Unity disconnected** → waits until Unity reconnects

Commands queue up and execute in order. The agent doesn't need to poll compilation status or manage timing.

## Windows Focus Behavior

Unity's editor loop pauses when the window is unfocused. Dreamer handles this:

- The **background bridge** keeps the daemon informed of Unity's state even when unfocused (heartbeat, compilation status)
- The CLI **auto-focuses Unity** when submitting commands so they execute immediately
- Use `--no-focus` to submit without focusing (commands queue and execute next time Unity is focused)

## Using with Claude Code

Add the Dreamer skill to your project so Claude knows how to use the CLI. Copy the skill file from this repo:

```bash
# In your game project
mkdir -p .claude/commands
cp path/to/Dreamer/.claude/commands/dreamer.md .claude/commands/dreamer.md
```

Then Claude can use `/dreamer` or will automatically use the CLI when doing Unity work.

## Agent Compatibility

Dreamer is designed for AI agents that have **terminal access** and operate from the **project root directory**. This is how Claude Code works — it sits at the root, sees the full file system, and runs CLI commands.

**Compatible:**
- **Claude Code** (CLI, VS Code extension, desktop app) — primary target, full support
- Any agent framework with shell/terminal access

**Not compatible:**
- **GitHub Copilot** — operates inside the C# solution context (.sln/.csproj), not the project root. Has no terminal access to run CLI commands. Copilot sees the code but can't interact with the Unity Editor through Dreamer.
- **Cursor Copilot++ / Tab** — autocomplete-focused, no command execution
- IDE assistants that only have code context without shell access

The core requirement is simple: the agent needs to be able to run `dreamer <command>` in a terminal. If it can do that, it can use Dreamer.

## Port Configuration

Default port: `18710`. Override with:

```bash
# Environment variable
export DREAMER_PORT=19000

# Or in Unity: EditorPrefs (set via the Agent Bridge Status window)
```

## License

MIT
