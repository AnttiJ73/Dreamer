# Dreamer — Install instructions (for Claude)

Installs Dreamer into the enclosing Unity project. Work from the project root (cwd must contain `Assets/`, `Packages/`, `ProjectSettings/` — stop if not).

**Source repo:** use whatever the user's install prompt specified; default `https://github.com/AnttiJ73/Dreamer.git` at ref `main`.

**Confirm before destructive steps** (overwrites, writing to `CLAUDE.md` / `.gitignore`).

---

## 1. Preflight

Required on PATH: `node` ≥ 18, `npm`, `git`. Missing any → stop, tell user.

Detect at project root. Report all collisions to the user and, for each, ask overwrite / skip / abort:

- `daemon/`, `Packages/com.dreamer.agent-bridge/`, `.claude/skills/dreamer/SKILL.md`, `bin/`, `CLAUDE.md`, `.gitignore`

Also check for a **legacy** `.claude/commands/dreamer.md` from installs that predate the skill migration — if present, tell the user it will be removed (the new skill at `.claude/skills/dreamer/SKILL.md` supersedes it) and proceed.

Special case — **stray `Dreamer/` directory**: on Windows/macOS (case-insensitive FS), a `Dreamer/` folder and a `dreamer` file collide. Almost always a prior botched `git clone` run at project root. Ask the user to delete or move it. Do not delete silently.

---

## 2. Clone

Clone to an **OS temp dir** — never the project root or a subdir (creates stray `Dreamer/`).

- POSIX / git-bash: `TMP=$(mktemp -d)`
- Windows PowerShell: `$tmp = Join-Path $env:TEMP "dreamer-install-$([guid]::NewGuid())"`

```
git clone --depth 1 --branch <ref> <repo-url> <tmp>
```

Record the SHA: `git -C <tmp> rev-parse HEAD`. Verify these exist in the clone, stop if any are missing:

- `daemon/src/`, `daemon/bin/`, `daemon/package.json`
- `Packages/com.dreamer.agent-bridge/`
- `.claude/skills/dreamer/SKILL.md`
- `bin/dreamer`, `bin/dreamer.cmd`

---

## 3. Collect config (Ask, don't default silently)

**Use the `AskUserQuestion` tool.** Do not skip this — the user expects to see questions.

If `<project>/daemon/.dreamer-config.json` already exists (re-install), first ask a single question: *"Keep existing Dreamer config, or reconfigure?"* — options: `Keep existing` / `Reconfigure`. If Keep → skip to Step 4.

**Port selection is automatic** — the daemon allocates a free port on first run and records `{projectPath → port}` in the shared projects registry (see [Projects registry](#projects-registry) below). You only need to ask if the user wants to override the default.

Ask these two questions in one `AskUserQuestion` call:

1. **Unity focus policy** — options: `Smart (Recommended)` / `Always` / `Never`. Header: `Focus`.
   - `Smart` (default): never focus upfront. If `--wait` is set and a command hasn't reached a terminal state after 5 s (tunable), focus once to unstick Unity's main thread. Rationale: on Windows, Unity's main thread doesn't tick at all for some work when unfocused — it stops, it doesn't slow down. If nothing's moved in 5 s, Unity is frozen, not busy.
   - `Always`: focus before every mutation command. Use if Unity is on a separate monitor and focus-steals don't bother you.
   - `Never`: no auto-focus, no stall fallback. Commands queue and only execute when Unity is focused by the user.
2. **Default --wait timeout (ms)** — options: `30000 (default)`, `60000`, `120000`, plus Other. Header: `Wait timeout`.

Remember the two values for Step 6.

If the user *really* wants to override the auto-allocated port (uncommon — collisions with existing processes are already avoided), call `node <tmp>/daemon/bin/dreamer.js probe-port` for a hint, then ask a third question and set `port` in `.dreamer-config.json` — the daemon will prefer it over the registry on first run.

---

## 4. Copy files

Apply per-path overwrite / skip decisions from Step 1.

- `<tmp>/daemon/` → `<project>/daemon/`. **Preserve** any existing `daemon/.dreamer-config.json`, `daemon/.dreamer-source.json`, and runtime files (`.dreamer-daemon.pid`, `.dreamer-daemon.log`, `.dreamer-queue.json`). Overwrite `daemon/src/`, `daemon/bin/`, `daemon/package.json`.
- `<tmp>/Packages/com.dreamer.agent-bridge/` → `<project>/Packages/com.dreamer.agent-bridge/`. Full replace. `.meta` files must survive byte-exact (Unity GUIDs).
- `<tmp>/.claude/skills/dreamer/SKILL.md` → `<project>/.claude/skills/dreamer/SKILL.md`. Create parent dirs as needed. This is a Claude Code **skill** (auto-loaded by Claude when Unity work appears), not a slash command. Don't touch anything else under `.claude/`. If a legacy `.claude/commands/dreamer.md` exists from a pre-migration install, remove it — the skill supersedes it.
- `<tmp>/.claude/settings.json` → merge into `<project>/.claude/settings.json`. This registers a `SessionStart` hook that runs `./bin/dreamer update --check` each time Claude opens the project, surfacing "Dreamer is out of date" without the user having to remember. If the project already has a `settings.json`, merge the `hooks.SessionStart` entry rather than overwriting.
- `<tmp>/bin/` → `<project>/bin/`. Both wrappers.

Then: `chmod +x <project>/bin/dreamer` (POSIX).

---

## 5. Link CLI (verify wrappers, do not `npm link`)

Dreamer is intentionally project-local. No global install. Test:

```
./bin/dreamer --help
```

Expect JSON help output. If it fails, confirm `daemon/bin/dreamer.js` exists and Node is on PATH.

---

## 6. Write config and source marker

**6a — `daemon/.dreamer-config.json`** (skip if user chose "Keep existing" in Step 3):

```json
{ "autoFocus": "smart"|"always"|"never", "defaultWaitTimeout": <ms> }
```

Include `"port": <port>` ONLY if the user explicitly overrode it in Step 3 — otherwise omit it and let the projects registry auto-allocate on first daemon start. The legacy `port` field, if present, is honored once as a migration hint when the registry entry is first created.

**6b — `daemon/.dreamer-source.json`**:

```json
{ "repo": "<repo-url>", "ref": "<ref>", "sha": "<commit-sha-from-step-2>" }
```

Required for `./bin/dreamer update` to self-update later. The `sha` field lets `./bin/dreamer update --check` detect drift cheaply via `git ls-remote`; the installer should stamp whatever `git -C <tmp> rev-parse HEAD` returned in Step 2.

---

## 7. Patch `.gitignore` and `CLAUDE.md`

**7a — `<project>/.gitignore`** — create if missing; append missing lines only:

```
daemon/.dreamer-daemon.pid
daemon/.dreamer-daemon.log
daemon/.dreamer-queue.json
```

Do NOT ignore `.dreamer-config.json` or `.dreamer-source.json` — those are committed.

**7b — `<project>/CLAUDE.md`** — create if missing; append (don't overwrite) this section:

```markdown
## Dreamer — Unity Editor automation

Invoke as `./bin/dreamer <command>` (POSIX/bash) or `.\bin\dreamer <command>` (Windows cmd/PowerShell) from the project root. Daemon auto-starts on first use; talks to Unity over localhost.

- Skill: `.claude/skills/dreamer/SKILL.md`
- Config: `daemon/.dreamer-config.json` (port, autoFocus, defaultWaitTimeout)
- Source tracking: `daemon/.dreamer-source.json`
- Update: `./bin/dreamer update` (preserves config)
- Always pass `--wait` to mutation commands
- After writing `.cs` files directly, run `./bin/dreamer refresh-assets --wait`
- Check `./bin/dreamer status` before mutating
```

---

## 8. Verify

Run `./bin/dreamer status`. Expect:
- `daemon.pid` set, `daemon.uptimeHuman` populated.
- `unity.connected: false` until Unity opens this project — that's fine.
- First run creates the projects-registry entry automatically (see section below).

If the daemon fails to start with `EADDRINUSE`, something outside Dreamer holds the allocated port (rare — the registry's allocator skips bound ports). The daemon log at `daemon/.dreamer-daemon.log` reports the port and the registry file path. Resolve by stopping the conflicting process or editing the registry's `port` field for this project and retrying.

---

## 9. Cleanup

Delete `<tmp>` recursively.

---

## 10. Tell the user

1. Open the project in Unity 6. Agent Bridge auto-activates via `InitializeOnLoad`.
2. `Tools > Dreamer > Toggle Bridge` menu should exist.
3. Re-run `./bin/dreamer status` — `unity.connected` should be `true`.
4. Smoke test: `./bin/dreamer find-assets --type prefab --wait`.
5. Report the install commit SHA from Step 2.
6. To update later: say *"update Dreamer"* to Claude.
7. **Mention optional add-ons**: uGUI (Canvas UI building) is available as a separate add-on — if the user plans to build uGUI menus/HUDs with Claude, they should also run *"Install the Dreamer UGUI add-on"*.

---

## 10a. Optional: UGUI add-on

If the user asks for the uGUI add-on (either during install or later), run:

```
./bin/dreamer addon install ugui
```

This fetches the `com.dreamer.agent-bridge.ugui` Unity package from the source repo and copies it into `Packages/`, plus the `.claude/skills/dreamer-ugui/` skill directory. It also stamps `addons: ["ugui"]` into `daemon/.dreamer-source.json` so future `./bin/dreamer update` invocations keep the add-on in sync.

Remove with: `./bin/dreamer addon remove ugui`. List installed: `./bin/dreamer addon list`.

The add-on adds three commands: `create-ui-tree` (declarative Canvas UI builder), `inspect-ui-tree` (dump an existing UI to the same schema), `set-rect-transform` (anchor/size/pivot helper). Without the add-on, these commands return a clear "add-on not installed" error — core Dreamer is unaffected.

---

## Projects registry

Dreamer maintains a shared `projects.json` at:

- Windows: `%APPDATA%\Dreamer\projects.json`
- Unix:    `$HOME/.dreamer/projects.json`

The file maps Unity project roots to daemon ports, so multiple Unity editors on the same machine coexist without port conflicts. Shape:

```json
{
  "version": 1,
  "projects": {
    "c:/users/you/unityprojects/my game": {
      "projectPath": "C:\\Users\\you\\UnityProjects\\My Game",
      "port": 18710,
      "daemonPid": 12345,
      "createdAt": "...",
      "lastStartedAt": "..."
    }
  }
}
```

Both the daemon (on startup) and every CLI invocation read it; the Unity bridge reads it in C# via `ProjectRegistry.cs`. You don't edit it by hand in normal use.

**Conflict enforcement:** if a Unity editor's bridge reports a `projectPath` that doesn't match the daemon's own project, the daemon returns HTTP 409 `wrong-project` with the expected path and (when available) the registered port for the caller's project. This prevents two Unity editors from racing on the same daemon.

**Port auto-allocation:** on first boot for a project, the daemon picks the first free port in `[18710, 18810)` that's not already claimed by another registered project and not held by another process. The chosen port is persisted in the registry and reused on subsequent boots.

## New commands worth knowing

- `remove-missing-scripts` — strips "Missing (Mono Script)" components left behind by deleted scripts. Targets a single prefab (`--asset PATH`), a scene object (`--scene-object PATH`), or an entire folder (`--path FOLDER`). Use `--dry-run` to preview. Recursive by default; pass `--non-recursive` for root-only.
- `set-property` now supports struct values, arrays/lists (including struct arrays), and self-component references:
  - Array: `--value '[1,2,3]'` or `--value '[{"field":v}, ...]'`
  - Struct: `--value '{"field":v}'`
  - Sibling component: `--value '[{"self":true,"component":"PlayerController"}]'`
- `inspect --scene-object "BareName"` — recursive, multi-scene lookup. Reports ambiguity with matching paths if multiple objects share the name.
- `status` and `compile-status` now include `status`/`ready` enums plus `{at, ageMs, ageHuman}` for every timestamp, and `queue.active[]` listing stuck non-terminal commands with their time-in-state.

## Failure modes

| Symptom | Fix |
|---|---|
| Node < 18 or missing | Stop; user installs Node 18+ |
| `git` not on PATH | Stop; user installs git |
| `git clone` fails | Report stderr verbatim (offline / auth / wrong ref) |
| Stray `Dreamer/` at project root | Ask user to delete/rename; do not touch silently |
| `./bin/dreamer` not executable (POSIX) | `chmod +x`; fallback `sh ./bin/dreamer <cmd>` or `node daemon/bin/dreamer.js <cmd>` |
| Daemon `EADDRINUSE` on start | Registry points at a port some other process holds — edit the entry's `port` field or remove the entry to force reallocation |
| Bridge logs "project is NOT registered" | Run `./bin/dreamer status` once from the project root to create the registry entry |
| HTTP 409 `wrong-project` in bridge logs | Bridge is pointed at the wrong daemon — verify registry has an entry for this project and that Unity reloaded the package |
| `Tools > Dreamer` menu missing after Unity load | Package not detected; reimport via Unity Package Manager |
| `unity.connected: false` after Unity open | Compile may still be running — check `./bin/dreamer compile-status`, wait, retry |
| Commands stuck in `waiting — Waiting for initial Unity state` on Windows | Unity unfocused; main thread isn't pushing state. Run `./bin/dreamer focus-unity` or any compile-safe command (`inspect-hierarchy`, `find-assets`) to kick Unity's update loop |
