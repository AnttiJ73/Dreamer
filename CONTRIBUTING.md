# Contributing to Dreamer

Thanks for looking. Dreamer is a solo-maintained tool right now, so
expect variable response time on issues and PRs.

## Architecture primer

Read [`CLAUDE.md`](CLAUDE.md) first — it covers the three-layer design
(CLI / Node daemon / Unity C# bridge), command lifecycle, file
layout, and core conventions.

Highlights worth knowing before you touch code:

- **Daemon**: Node.js, CommonJS, zero external runtime deps (all
  built-ins). This is intentional — keeps `./bin/dreamer update`
  dead simple and avoids supply-chain surface.
- **Unity side**: C#, Editor-only, `Dreamer.AgentBridge` namespace,
  `UnityWebRequest` for HTTP. Background HTTP bridge handles the
  Windows-unfocused case where Unity's main thread stops ticking.
- **Protocol**: JSON over HTTP on localhost. Daemon is the server,
  Unity is a polling client, CLI is a request client. Commands go
  through a persistent queue + scheduler with state machine
  `queued → waiting → dispatched → running → succeeded/failed/cancelled`.
- **Compile safety**: `command.js` has a `COMPILE_SAFE_KINDS` allowlist
  mirrored in Unity's `CommandDispatcher`. Keep them in sync.

## Development setup

1. Clone this repo anywhere (doesn't have to be a Unity project).
2. `cd daemon && npm test` — runs the 44-test daemon suite with zero
   deps.
3. For end-to-end testing, install into a scratch Unity 6 project
   following [`INSTALL.md`](INSTALL.md). Use a separate port if you
   have another Dreamer install running (`./bin/dreamer probe-port`).

## Making changes

- **Daemon-only changes**: usually testable via the daemon suite.
  Add tests in `daemon/test/*.test.js` for new logic.
- **Unity-side changes**: require manual validation in a real Unity
  project. There's no Unity test runner wired up yet. Document what
  you tested in the PR description.
- **Cross-cutting changes** (wire protocol, command kinds): update
  both sides atomically, and update the `COMPILE_SAFE_KINDS` list in
  both `daemon/src/command.js` and
  `Packages/com.dreamer.agent-bridge/Editor/Core/CommandDispatcher.cs`
  if relevant.

## Commit / PR conventions

- Keep commits focused — one logical change per commit.
- Commit messages in the style of `git log --oneline` on main:
  short imperative first line, optional body.
- PR description should cover: what changed, why, how you tested,
  any migration impact on existing installs (since `./bin/dreamer
  update` pulls `main`, breaking changes are user-visible fast).

## Updating the CHANGELOG

Add an entry under `## [Unreleased]` in
[`CHANGELOG.md`](CHANGELOG.md) for any user-visible change. The
maintainer consolidates these into a release entry when cutting a tag.

## Reporting bugs

Use the [bug report template](.github/ISSUE_TEMPLATE/bug_report.md).
The environment section matters — Unity version, OS, and the
`daemon/.dreamer-source.json` commit SHA are the three that most
often determine whether a bug is reproducible.
