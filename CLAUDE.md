# Dreamer — Unity Agent Automation Bridge

## What this is

A tool (not a game) that enables LLM agents to automate Unity Editor operations via a simple CLI. Three layers:

1. **CLI** (`daemon/bin/dreamer.js`) — Agent-facing command surface
2. **Daemon** (`daemon/src/`) — Persistent Node.js process, HTTP server on localhost:18710, command queue + scheduler
3. **Unity Package** (`Packages/com.dreamer.agent-bridge/`) — Editor-side C# bridge that polls daemon and executes commands

## Architecture

```
Agent (Claude) → CLI (dreamer) → Daemon (HTTP, :18710) ← Unity Editor (HTTP polling)
```

- Daemon is the operational anchor — survives Unity domain reloads
- Unity polls for pending commands, reports results and editor state
- CLI auto-starts daemon if not running
- Commands that depend on compilation wait automatically

## Running

```bash
# From daemon/ directory
npm link          # Makes 'dreamer' available globally
dreamer status    # Auto-starts daemon, shows status

# Or run daemon explicitly
node daemon/src/server.js
```

Unity side activates automatically when the package is loaded (InitializeOnLoad). Toggle via `Tools > Dreamer > Toggle Agent Bridge`.

## Key commands

```bash
dreamer find-assets --type prefab --name "Player*"
dreamer inspect Assets/Prefabs/Player.prefab
dreamer create-script --name PlayerController --namespace Game
dreamer add-component --asset Assets/Prefabs/Player.prefab --type PlayerController --wait
dreamer set-property --asset Assets/Prefabs/Player.prefab --component PlayerController --property speed --value 5.0
dreamer queue --state waiting
dreamer compile-status
dreamer console --count 20
```

## Development conventions

- **Daemon**: Node.js CommonJS, zero external dependencies, all built-in modules only
- **Unity**: C# in `Dreamer.AgentBridge` namespace, Editor-only code, uses UnityWebRequest for HTTP
- **Protocol**: JSON over HTTP. Daemon is server, Unity is polling client, CLI is request client
- **Port**: 18710 default, configurable via `DREAMER_PORT` env var or EditorPrefs

## File structure

```
daemon/
  bin/dreamer.js              CLI entry point
  src/server.js               HTTP server + route dispatch
  src/queue.js                Command queue with JSON persistence
  src/command.js              Command model, factory, state machine
  src/scheduler.js            Evaluates requirements, dispatches to Unity
  src/unity-state.js          Cached Unity editor state
  src/daemon-manager.js       Daemon auto-start/stop for CLI
  src/cli.js                  CLI command routing
  src/handlers/commands.js    /api/commands endpoints
  src/handlers/unity.js       /api/unity endpoints
  src/handlers/status.js      /api/status endpoints

Packages/com.dreamer.agent-bridge/
  Editor/Core/
    AgentBridgeBootstrap.cs   InitializeOnLoad entry point
    DaemonClient.cs           HTTP client (UnityWebRequest)
    CommandDispatcher.cs      Routes commands to operation handlers
    CompilationMonitor.cs     Tracks compilation state
    ConsoleCapture.cs         Captures console log entries
  Editor/Operations/
    AssetOps.cs               find_assets, inspect_asset, save_assets
    PrefabOps.cs              create_prefab
    ComponentOps.cs           add_component, remove_component
    PropertyOps.cs            set_property
    ScriptOps.cs              create_script
    SceneOps.cs               create_gameobject, inspect_hierarchy
  Editor/Protocol/
    Messages.cs               Wire types + SimpleJson parser/builder
  Editor/UI/
    AgentBridgeWindow.cs      Editor window for status/settings
```

## Command lifecycle

1. CLI submits command → daemon queues it as `queued`
2. Scheduler evaluates requirements (compilation done? Unity connected? dependency met?)
3. When ready → `dispatched`
4. Unity polls, receives command → daemon marks `running`
5. Unity executes, reports result → `succeeded` or `failed`
6. Commands with unmet requirements stay `waiting` with a reason

## Important: never commit

- `daemon/.dreamer-daemon.pid`
- `daemon/.dreamer-daemon.log`
- `daemon/.dreamer-queue.json`
