# Dreamer daemon

Middle layer of [Dreamer](https://github.com/AnttiJ73/Dreamer) — a Unity
Editor automation bridge for LLM agents. This directory holds the
Node.js daemon and CLI that sit between the agent (Claude) and Unity.

If you're reading this file cold (human or LLM), here's what you need
to know:

## What this is

```
Agent (Claude) → CLI (./bin/dreamer) → Daemon (HTTP, :18710) ← Unity Editor (HTTP polling)
```

- **CLI** — `bin/dreamer.js`. Parses arguments, submits commands to the daemon, prints JSON results. Auto-starts the daemon if it isn't running. One executable per `dreamer <subcommand>`.
- **Daemon** — `src/server.js`. Persistent HTTP server on localhost. Holds a command queue (`.dreamer-queue.json`), tracks Unity state, decides when commands are safe to execute. Survives Unity domain reloads.
- **Unity bridge** — at `../Packages/com.dreamer.agent-bridge/Editor/`. Polls the daemon over HTTP, executes commands against the Editor API, reports results back.

The daemon is the operational anchor. Agents talk to it via the CLI, Unity polls it for work. Commands that depend on compilation (`add-component`, `remove-component`) wait in the queue until Unity reports it's idle.

## Source map

| File | Role |
|---|---|
| `bin/dreamer.js` | CLI entry point |
| `src/server.js` | HTTP server + route dispatch |
| `src/cli.js` | CLI subcommand routing |
| `src/config.js` | Load/save `.dreamer-config.json`; port probe |
| `src/daemon-manager.js` | Start/stop the daemon, HTTP plumbing for the CLI |
| `src/queue.js` | Command queue with JSON-file persistence |
| `src/command.js` | Command model, state machine |
| `src/scheduler.js` | Evaluates requirements (compilation, deps); dispatches |
| `src/unity-state.js` | Cached Unity editor state |
| `src/handlers/commands.js` | `/api/commands` endpoints |
| `src/handlers/unity.js` | `/api/unity` endpoints (Unity polls these) |
| `src/handlers/status.js` | `/api/status` endpoints |

## Running standalone

Normally the CLI auto-starts the daemon. To run it manually:

```bash
node src/server.js              # foreground, logs to stdout
node src/server.js --daemon     # detached, logs to .dreamer-daemon.log
```

## Runtime state files (never commit)

- `.dreamer-daemon.pid` — PID of the running daemon
- `.dreamer-daemon.log` — detached-mode log output
- `.dreamer-queue.json` — persisted command queue

These are listed in `.gitignore`.

## Committed config

- `.dreamer-config.json` — `port`, `autoFocus`, `defaultWaitTimeout`. Read by the CLI, daemon, and Unity bridge.
- `.dreamer-source.json` — `repo`, `ref`. Used by `./bin/dreamer update` to self-update.

## Conventions

- **Zero external dependencies.** Built-in Node modules only (`http`, `fs`, `net`, `path`, `child_process`).
- **JSON over HTTP.** Daemon is server, Unity is polling client, CLI is request client.
- **CommonJS** (`require`, not `import`).
- Target Node 18+.
