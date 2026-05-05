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

Dreamer is **project-local** — no global install. Use the `./bin/dreamer` wrapper at the project root (or `.\bin\dreamer` on Windows cmd/PowerShell). The daemon auto-starts on the first invocation.

```bash
./bin/dreamer status    # Auto-starts daemon, shows status

# Or run the daemon process explicitly
node daemon/src/server.js
```

Unity side activates automatically when the package is loaded (InitializeOnLoad). Toggle via `Tools > Dreamer > Toggle Bridge`.

## Key commands

```bash
./bin/dreamer find-assets --type prefab --name "Player*"
./bin/dreamer inspect Assets/Prefabs/Player.prefab
./bin/dreamer create-script --name PlayerController --namespace Game
./bin/dreamer add-component --asset Assets/Prefabs/Player.prefab --type PlayerController --wait
./bin/dreamer set-property --asset Assets/Prefabs/Player.prefab --component PlayerController --property speed --value 5.0
./bin/dreamer queue --state waiting
./bin/dreamer compile-status
./bin/dreamer console --count 20
```

## Development conventions

- **Daemon**: Node.js CommonJS, zero external dependencies, all built-in modules only
- **Unity**: C# in `Dreamer.AgentBridge` namespace, Editor-only code, uses UnityWebRequest for HTTP
- **Protocol**: JSON over HTTP. Daemon is server, Unity is polling client, CLI is request client
- **Port**: 18710 default, configurable via `DREAMER_PORT` env var or EditorPrefs

## Branch policy

**Commit to `main` directly.** Don't create long-lived feature branches.

Every commit on `main` is a release: downstream projects install Dreamer with `.dreamer-source.json` recording `ref: 'main'` (the default), and `./bin/dreamer update` + `./bin/dreamer addon install <name>` clone from that ref. So a stale `main` means stale downstream installs — and a feature branch that holds 50+ commits while `main` stagnates breaks the install path entirely (kinds and add-on packages that exist on the feature branch won't be found by `addon install`).

Past incident (May 2026): `feature/ugui-addon` accumulated 59 commits — all three add-on packages, the search tool, sprite validation — while `main` was last touched in April. A user installing Dreamer in another project saw `dreamer addon install ugui` fail and Claude correctly concluded "no UGUI tools exist." Fixed by merging the branch and adopting this policy.

Branches are still fine for genuinely speculative or incomplete work that shouldn't ship yet — but merge as soon as the work is usable, and never let one outlive a single sprint of changes.

## Changelog

When you commit a user-visible Dreamer change, append a bullet to `CHANGELOG.md` under `## [Unreleased]` in the same commit. User-visible = new commands, new flags, behavior changes, observable bug fixes. Refactors, comment-trims, and internal renames stay out (git log covers those).

Format: `### Added` / `### Changed` / `### Fixed` sections, one bullet per logical change, dated and SHA-tagged when convenient.

This isn't decorative. `./bin/dreamer update` diffs CHANGELOG.md between the previous and new install and emits `changelog.newEntries[]`; the dreamer skill instructs the running agent to read those entries to the downstream user. Skipping the changelog entry means the next person to update sees "no changes" even when there are.

## Code style — comments

Default to **no comments**. The code is the source of truth.

Add a comment ONLY when one of:
- A non-obvious *why* (a constraint, a Unity quirk, a past incident the code defends against). The *what* should be readable from the code itself.
- A directive other agents will need (e.g. "keep this list in sync with X").
- A short summary on a public API surface (one line).

Avoid:
- Multi-paragraph XML doc comments. One line max.
- Comments that restate what the code does.
- Comments justifying a refactor or describing what changed (that's commit message territory).
- Decorative dividers (`// ── Section ──`) inside small files. Use them sparingly in long files only when they aid navigation.

When editing a file with existing verbose comments, leave them alone unless they're stale or wrong — bulk rewrites are out of scope. Apply this rule to new and modified blocks only.

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
