# Dreamer — Install instructions (for Claude)

Installs Dreamer into the enclosing Unity project. Work from the project root (cwd must contain `Assets/`, `Packages/`, `ProjectSettings/` — stop if not).

**Source repo:** use whatever the user's install prompt specified; default `https://github.com/AnttiJ73/Dreamer.git` at ref `main`.

**Confirm before destructive steps** (overwrites, writing to `CLAUDE.md` / `.gitignore`).

---

## 1. Preflight

Required on PATH: `node` ≥ 18, `npm`, `git`. Missing any → stop, tell user.

Detect at project root. Report all collisions to the user and, for each, ask overwrite / skip / abort:

- `daemon/`, `Packages/com.dreamer.agent-bridge/`, `.claude/commands/dreamer.md`, `bin/`, `CLAUDE.md`, `.gitignore`

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
- `.claude/commands/dreamer.md`
- `bin/dreamer`, `bin/dreamer.cmd`

---

## 3. Collect config (Ask, don't default silently)

**Use the `AskUserQuestion` tool.** Do not skip this — the user expects to see questions.

If `<project>/daemon/.dreamer-config.json` already exists (re-install), first ask a single question: *"Keep existing Dreamer config, or reconfigure?"* — options: `Keep existing` / `Reconfigure`. If Keep → skip to Step 4.

Otherwise (fresh install or user chose Reconfigure), probe a free port first:

```
node <tmp>/daemon/bin/dreamer.js probe-port
```

Returns JSON like `{"port": 18711, ...}` — the first free port in 18710..18719. If it errors "No free port", widen with `--start 19000 --count 20`.

Then ask all three questions in one `AskUserQuestion` call:

1. **Port** — options: `<probed> (Recommended — free)`, `18710 (default)`, plus user can type Other. Header: `Port`.
2. **Unity focus policy** — options: `Smart (Recommended)` / `Always` / `Never`. Header: `Focus`.
   - `Smart` (default): never focus upfront. If `--wait` is set and a command hasn't reached a terminal state after 5 s (tunable), focus once to unstick Unity's main thread. Rationale: on Windows, Unity's main thread doesn't tick at all for some work when unfocused — it stops, it doesn't slow down. If nothing's moved in 5 s, Unity is frozen, not busy.
   - `Always`: focus before every mutation command. Use if Unity is on a separate monitor and focus-steals don't bother you.
   - `Never`: no auto-focus, no stall fallback. Commands queue and only execute when Unity is focused by the user.
3. **Default --wait timeout (ms)** — options: `30000 (default)`, `60000`, `120000`, plus Other. Header: `Wait timeout`.

Remember the three values for Step 6.

---

## 4. Copy files

Apply per-path overwrite / skip decisions from Step 1.

- `<tmp>/daemon/` → `<project>/daemon/`. **Preserve** any existing `daemon/.dreamer-config.json`, `daemon/.dreamer-source.json`, and runtime files (`.dreamer-daemon.pid`, `.dreamer-daemon.log`, `.dreamer-queue.json`). Overwrite `daemon/src/`, `daemon/bin/`, `daemon/package.json`.
- `<tmp>/Packages/com.dreamer.agent-bridge/` → `<project>/Packages/com.dreamer.agent-bridge/`. Full replace. `.meta` files must survive byte-exact (Unity GUIDs).
- `<tmp>/.claude/commands/dreamer.md` → `<project>/.claude/commands/dreamer.md`. Create parent dirs as needed. Don't touch anything else under `.claude/`.
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
{ "port": <port>, "autoFocus": "smart"|"always"|"never", "defaultWaitTimeout": <ms> }
```

The CLI, daemon, and Unity package all read `port` from this file automatically — no `DREAMER_PORT` env var or EditorPrefs change needed.

**6b — `daemon/.dreamer-source.json`**:

```json
{ "repo": "<repo-url>", "ref": "<ref>" }
```

Required for `./bin/dreamer update` to self-update later.

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

- Skill: `.claude/commands/dreamer.md`
- Config: `daemon/.dreamer-config.json` (port, autoFocus, defaultWaitTimeout)
- Source tracking: `daemon/.dreamer-source.json`
- Update: `./bin/dreamer update` (preserves config)
- Always pass `--wait` to mutation commands
- After writing `.cs` files directly, run `./bin/dreamer refresh-assets --wait`
- Check `./bin/dreamer status` before mutating
```

---

## 8. Verify

Run `./bin/dreamer status`. Expect `daemon.running: true`. `unity.connected` is `false` until Unity is opened with this project — that's fine.

If the daemon fails to start with `EADDRINUSE`, the port is in use (probe result stale). Re-run `./bin/dreamer probe-port`, update the port via `./bin/dreamer config set port=<N>`, retry.

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

---

## Failure modes

| Symptom | Fix |
|---|---|
| Node < 18 or missing | Stop; user installs Node 18+ |
| `git` not on PATH | Stop; user installs git |
| `git clone` fails | Report stderr verbatim (offline / auth / wrong ref) |
| Stray `Dreamer/` at project root | Ask user to delete/rename; do not touch silently |
| `./bin/dreamer` not executable (POSIX) | `chmod +x`; fallback `sh ./bin/dreamer <cmd>` or `node daemon/bin/dreamer.js <cmd>` |
| Daemon `EADDRINUSE` on start | Re-probe port, update config, retry |
| `Tools > Dreamer` menu missing after Unity load | Package not detected; reimport via Unity Package Manager |
| `unity.connected: false` after Unity open | Compile may still be running — check `./bin/dreamer compile-status`, wait, retry |
