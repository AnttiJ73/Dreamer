# Dreamer — Installation Instructions (for Claude)

You are installing the Dreamer Unity automation bridge into the user's Unity project. This file is read from a fresh clone of the Dreamer git repo. Execute every step below in order. **Confirm with the user before each destructive step** (file moves, overwrites, writes to `CLAUDE.md`/`.gitignore`).

This document is self-contained. Do not ask the user for information that is covered here — derive it from the filesystem.

**Repo URL and ref:** if the user pasted an install prompt that specified a repo URL and/or ref, use those. Otherwise default to `https://github.com/AnttiJ73/Dreamer.git` at ref `main`. Record the values you actually use — you will write them to `daemon/.dreamer-source.json` in Step 7.

---

## Step 0 — Preflight

1. Confirm CWD is the Unity project root — it must contain `Assets/`, `Packages/`, and `ProjectSettings/`. If not, stop and tell the user.
2. Check prerequisites:
   - `node --version` — must be ≥ 18. If lower or missing, stop.
   - `npm --version` — must be present.
   - `git --version` — must be present. Required for both install and future `./dreamer update`.
   - Unity 6 (6000.0+) — user confirms verbally.
3. Detect collisions at the project root:
   - `daemon/`
   - `Packages/com.dreamer.agent-bridge/`
   - `.claude/commands/dreamer.md`
   - `dreamer` (POSIX wrapper)
   - `dreamer.cmd` (Windows wrapper)
   - `CLAUDE.md`
   - `.gitignore`
4. Summarize collisions to the user. For each, ask: overwrite, skip, or abort. Apply those decisions in later steps.

---

## Step 1 — Collect configuration preferences

Check whether `<project-root>/daemon/.dreamer-config.json` already exists.

- **If it exists** (re-install over a prior Dreamer install): read and display the current values. Ask the user: "Keep existing config, or reconfigure?" If they keep it, skip the questions below and reuse the file as-is in Step 7. If they reconfigure, ask the questions using current values as defaults.
- **If it does not exist** (fresh install): ask the questions below with the listed defaults. Accept "default" / empty as "use the default".

1. **Daemon port** (default: `18710`)
   - localhost TCP port the daemon listens on; Unity polls it. Change only if 18710 conflicts on this machine.
2. **Auto-focus Unity** (default: `true`)
   - When true, every mutation command brings Unity to the foreground (Windows pauses unfocused Unity). Set to `false` if the user runs Unity on a second monitor and doesn't want focus stolen. `--no-focus` / `--focus` still override per-command.
3. **Default wait timeout in ms** (default: `30000`)
   - How long `--wait` blocks before giving up. Increase for slow machines or long-compiling projects.

If the user says "use defaults", skip the questions and use `{ "port": 18710, "autoFocus": true, "defaultWaitTimeout": 30000 }`.

---

## Step 2 — Clone the Dreamer repo

Clone shallowly to an OS temp directory:

```bash
git clone --depth 1 --branch <ref> <repo-url> <tmp-dir>
```

Use `os.tmpdir()`-equivalent (`$TMPDIR`, `%TEMP%`, `/tmp`) + a unique subdir. Record `<tmp-dir>` — you will delete it in Step 10.

After cloning, capture the commit SHA (`git rev-parse HEAD` in the clone dir). You'll report it to the user in Step 9.

Verify these paths exist inside the clone. If any are missing, stop and report which:
- `daemon/src/`
- `daemon/bin/`
- `daemon/package.json`
- `Packages/com.dreamer.agent-bridge/`
- `.claude/commands/dreamer.md`
- `dreamer`
- `dreamer.cmd`

---

## Step 3 — Copy the daemon

Copy `<tmp-dir>/daemon/` → `<project-root>/daemon/` preserving directory structure.

- If `daemon/` already exists and the user chose "overwrite" in preflight: delete the existing `daemon/src/`, `daemon/bin/`, and `daemon/package.json`, then copy. **Preserve** `daemon/.dreamer-config.json`, `daemon/.dreamer-source.json`, and any runtime state files (`.dreamer-daemon.pid`, `.dreamer-daemon.log`, `.dreamer-queue.json`) if they exist.
- If "skip": leave `daemon/` untouched.
- If "abort": stop the installer.

Do not copy any `.dreamer-daemon.pid`, `.dreamer-daemon.log`, or `.dreamer-queue.json` from the clone — those are runtime artifacts that should never be committed, but filter defensively.

---

## Step 4 — Copy the Unity package

Copy `<tmp-dir>/Packages/com.dreamer.agent-bridge/` → `<project-root>/Packages/com.dreamer.agent-bridge/`.

Unity auto-detects embedded packages under `Packages/`, so no `manifest.json` edit is needed. Preserve all `.meta` files exactly — Unity requires them for stable asset GUIDs.

---

## Step 5 — Install the Claude skill

- Ensure `<project-root>/.claude/commands/` exists (create directories if missing).
- Copy `<tmp-dir>/.claude/commands/dreamer.md` → `<project-root>/.claude/commands/dreamer.md`.
- Do not touch any other files under `.claude/`.

---

## Step 6 — Install the project-local CLI wrappers

Dreamer is a **project-local tool**. There is no global install — the CLI runs from `<project-root>/daemon/` and operates on state that lives next to it (config, queue, PID). Each Unity project gets its own independent Dreamer.

Copy two wrapper scripts from the clone to the project root:

- `<tmp-dir>/dreamer` → `<project-root>/dreamer` (POSIX shell wrapper)
- `<tmp-dir>/dreamer.cmd` → `<project-root>/dreamer.cmd` (Windows wrapper)

After copying, make the POSIX wrapper executable:

```bash
chmod +x <project-root>/dreamer
```

Verify:

```bash
./dreamer --help    # POSIX / bash / git-bash on Windows
.\dreamer --help    # Windows cmd / PowerShell
```

Both should print the JSON help output. If not, check that `<project-root>/daemon/bin/dreamer.js` exists and Node is on PATH.

**Important:** from here on, every Dreamer command is invoked as `./dreamer <command>` (or `.\dreamer <command>` on Windows). Do not run `npm link` — this tool intentionally avoids global state so multiple Unity projects can each have their own Dreamer install without collisions.

---

## Step 7 — Write configuration and source marker

**7a — Config.** If the user kept existing config in Step 1, leave `<project-root>/daemon/.dreamer-config.json` untouched. Otherwise write pretty-printed JSON:

```json
{
  "port": <port>,
  "autoFocus": <true|false>,
  "defaultWaitTimeout": <ms>
}
```

If `port` is not the default (`18710`), tell the user they must also `export DREAMER_PORT=<port>` in their shell if they ever launch the daemon directly with `node src/server.js` (the CLI reads `.dreamer-config.json` automatically).

**7b — Source marker.** Write `<project-root>/daemon/.dreamer-source.json` with the repo URL and ref you used in Step 2:

```json
{
  "repo": "<repo-url>",
  "ref": "<ref>"
}
```

This file is required for `./dreamer update` to work. If the user wants to pin to a tag instead of `main`, ask before writing and use their chosen ref.

---

## Step 8 — Update `.gitignore` and `CLAUDE.md`

**8a — `.gitignore`.** Ensure the project root `.gitignore` contains these lines. Append if missing, create the file if absent:

```
daemon/.dreamer-daemon.pid
daemon/.dreamer-daemon.log
daemon/.dreamer-queue.json
```

Do not add `daemon/.dreamer-config.json` or `daemon/.dreamer-source.json` — those are intentionally committed so config and update tracking are reproducible.

**8b — `CLAUDE.md`.** If `<project-root>/CLAUDE.md` does not exist, create it. Otherwise append (do not overwrite) the following section. Substitute the actual configured port if it isn't `18710`.

```markdown
## Dreamer — Unity Editor automation

This project uses Dreamer to let Claude automate Unity Editor operations via a project-local CLI. Invoke every command as `./dreamer <command>` (POSIX/bash) or `.\dreamer <command>` (Windows cmd/PowerShell) from the project root. The daemon auto-starts on any invocation and talks to Unity over localhost:<PORT>.

- Skill file: `.claude/commands/dreamer.md` (use `/dreamer` or just call the CLI)
- CLI wrappers: `./dreamer` and `.\dreamer.cmd` at the project root
- Daemon source: `daemon/`
- Unity package: `Packages/com.dreamer.agent-bridge/`
- Config: `daemon/.dreamer-config.json` (port, autoFocus, defaultWaitTimeout)
- Source tracking: `daemon/.dreamer-source.json` (repo + ref for `./dreamer update`)
- Updates: run `./dreamer update` to pull the latest from the recorded ref (default `main`). Config is preserved.
- Always pass `--wait` to mutation commands so you see the result before proceeding.
- If you write `.cs` files directly, run `./dreamer refresh-assets --wait` afterward.
- Check `./dreamer status` to confirm Unity is connected before mutating.
```

---

## Step 9 — Verify

Run `./dreamer status`. Expected: JSON with `daemon.running: true`. `unity.connected` will be `false` until the user opens Unity with this project — that's fine. Report the full output and the commit SHA captured in Step 2 to the user.

If the daemon fails to start because the port is in use, ask the user for a different port, rewrite `daemon/.dreamer-config.json`, kill any stale daemon (`./dreamer daemon stop`), and retry.

---

## Step 10 — Cleanup

Delete the temp clone directory from Step 2 recursively. This is not optional — leaving it around wastes disk and confuses future debugging.

---

## Post-install — instructions to relay to the user

Tell the user these exact next steps:

1. Open this project in Unity 6 — the Agent Bridge activates on load via `InitializeOnLoad`.
2. Verify the menu `Tools > Dreamer > Toggle Agent Bridge` exists and open the Agent Bridge status window.
3. Re-run `./dreamer status` — `unity.connected` should now be `true`.
4. Smoke test: `./dreamer find-assets --type prefab --wait`.
5. To update later, just say "update Dreamer" — Claude will run `./dreamer update`, which pulls the latest from the recorded ref and preserves your config.

---

## Failure modes reference

- **Node < 18** — stop at Step 0; user must install Node 18+.
- **git not on PATH** — stop at Step 0; user must install git. Both install and `./dreamer update` require it.
- **Clone fails (network / auth / wrong ref)** — report `git clone`'s stderr verbatim. Common causes: offline, repo went private (user needs git credentials), ref renamed.
- **POSIX `dreamer` wrapper not executable** — run `chmod +x ./dreamer`. If that still fails (e.g. the filesystem doesn't preserve the exec bit), invoke explicitly as `sh ./dreamer <command>` or `node daemon/bin/dreamer.js <command>`.
- **Port already in use** — ask for a different port, rewrite `.dreamer-config.json`, retry.
- **Unity doesn't show `Tools > Dreamer` menu after opening the project** — the package wasn't detected. Verify `Packages/com.dreamer.agent-bridge/package.json` exists and has valid JSON. Have the user reimport via Unity's Package Manager window.
- **`./dreamer status` shows `unity.connected: false` after Unity is open** — compilation may still be running (check `./dreamer compile-status`), or `InitializeOnLoad` hasn't fired yet. Wait, then retry.
