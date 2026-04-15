# Dreamer

Unity Editor automation bridge for LLM agents. Lets Claude (or any
agent with terminal access) create scripts, prefabs, components, scene
objects, and wire up references via a simple CLI. The agent doesn't
need to track Unity's compilation or domain reloads — Dreamer handles
the timing.

## Prerequisites

Unity 6 (6000.0+), Node.js 18+, `git` on PATH, and
[Claude Code](https://claude.com/product/claude-code) in the Unity project root.

## Install

Open Claude Code in your Unity project root and paste:

> Install Dreamer into this Unity project by cloning
> `https://github.com/AnttiJ73/Dreamer.git` and following its `INSTALL.md`.

Claude clones the repo, asks about config (port, auto-focus, wait
timeout — probing for a free port if another project already uses
18710), copies the daemon, Unity package, and Claude skill into place,
and verifies with `./bin/dreamer status`. Each project gets its own
independent install — multiple Unity projects coexist on distinct
ports.

## Updating

Tell Claude *"update Dreamer"*. Claude runs `./bin/dreamer update`,
pulls the latest, replaces files, preserves your config.

## Docs

- [`INSTALL.md`](INSTALL.md) — full install sequence
- [`.claude/commands/dreamer.md`](.claude/commands/dreamer.md) — CLI reference
- [`CLAUDE.md`](CLAUDE.md) — architecture for contributors

## License — MIT
