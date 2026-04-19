# Dreamer

**Claude Code's Unity Editor automation bridge.** Say *"add a
Rigidbody to the Player prefab"* or *"wire these ScriptableObjects
into the DamageSystem"* and Claude does it — no clicking, no
copy-paste, no Unity stalls. Dreamer handles compilation timing,
domain reloads, and focus quirks so the agent doesn't have to.

Also works with any other LLM agent that has terminal access.

## Prerequisites

Unity 6 (6000.0+), Node.js 18+, `git` on PATH, and
[Claude Code](https://claude.com/product/claude-code) in the Unity project root.

## Install

Open Claude Code in your Unity project root and paste:

> Install Dreamer from https://github.com/AnttiJ73/Dreamer.git

Claude clones the repo, asks about config (auto-focus policy and wait
timeout), copies the daemon, Unity package, and Claude skill into
place, and verifies with `./bin/dreamer status`. Each project gets its
own daemon; port selection is automatic.

### Unity-package-only install (no daemon/CLI, no Claude skill)

If you just want the Unity C# bridge (to talk to your own daemon /
tooling), Unity Package Manager can install it directly from the
repo subpath:

```
https://github.com/AnttiJ73/Dreamer.git?path=Packages/com.dreamer.agent-bridge
```

Window → Package Manager → + → Add package from git URL.

### Multi-project support

A shared registry at `%APPDATA%\Dreamer\projects.json` (Windows) or
`~/.dreamer/projects.json` (Unix) maps each Unity project root to its
allocated daemon port. First `./bin/dreamer status` from a new project
picks the next free port in `[18710, 18810)` and persists it. Open as
many Unity projects as you want — each talks to its own daemon on its
own port, and the daemon rejects cross-project traffic with HTTP 409
so bridges never accidentally take commands meant for another project.

## Updating

Tell Claude *"update Dreamer"*. Claude runs `./bin/dreamer update`,
pulls the latest, replaces files, preserves your config.

## Docs

- [`INSTALL.md`](INSTALL.md) — full install sequence
- [`.claude/skills/dreamer/SKILL.md`](.claude/skills/dreamer/SKILL.md) — CLI reference (Claude Code skill, auto-loaded)
- [`CHANGELOG.md`](CHANGELOG.md) — release history
- [`CLAUDE.md`](CLAUDE.md) — architecture for contributors
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — how to hack on Dreamer
- [`MAC.md`](MAC.md) — macOS compatibility notes (untested, likely works)

## Issues & feedback

Bug reports, feature requests, and Unity-quirk logs → [GitHub Issues](https://github.com/AnttiJ73/Dreamer/issues).

## License

[MIT](LICENSE). Use it, fork it, ship it.
