# Changelog

All notable changes to Dreamer. Format roughly follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/).

Until the first tagged release, `main` is the live reference. After `v0.1.0`
tags, breaking changes bump the minor version (0.x.0), fixes bump patch.

## [Unreleased]

### Added
- **`refresh-assets` auto-heal for "Unknown type" script misclassification.**
  Unity sometimes imports a `.cs` file via `DefaultImporter` (unknown asset
  type) instead of `MonoImporter` when the write lands while the Editor is
  unfocused on Windows. The MonoScript subasset never gets generated, so
  `add-component` fails and the script can't be dragged onto a GameObject.
  The daemon-side asset watcher now tracks which `.cs` files changed since
  the last refresh, and `refresh-assets` force-reimports any file Unity
  didn't classify as MonoScript. Result JSON includes `reimported[]` and
  `misclassified[]`.
- **`reimport-script` rescue command** — force-reimports `.cs` files under a
  path (file or folder, recursive by default), then kicks
  `CompilationPipeline.RequestScriptCompilation()`. Use when the auto-heal
  in `refresh-assets` didn't catch a misclassified file, or when the watcher
  missed the original write.
- **`set-property` property-name aliasing for built-in components** —
  Unity built-ins serialize as `m_Pascal` (e.g. `m_Sprite`, `m_LocalPosition`).
  The CLI now accepts the C# camelCase form (`sprite`, `localPosition`,
  `color`, `isTrigger`) and falls back to `m_<Cap>` on lookup failure. The
  result JSON includes `resolvedPath` so callers see which form Unity used.
  User-defined `[SerializeField]` fields keep their declared name unchanged.
- **`create-hierarchy` now surfaces component warnings instead of dropping
  silently.** Unknown types, not-a-Component types, and duplicates get
  recorded into a `warnings[]` array in the result JSON with the node path
  and reason.
- **`compile-status` summary shows age next to timestamps.**
  `Last observed clean compile: 2026-04-19T14:22:11Z (3m 14s ago).`

### Fixed
- **`lastCompileSuccess` now updates on every compile**, not just the first
  one after daemon startup. The previous logic had two guards that both
  missed the common case: the bridge-restore path only ran when the value
  was null, and the edge-detection path required the daemon to observe
  `compiling: true → false` directly (short compiles finish between state
  ticks, so the edge was never registered). Bridge timestamp is now
  accepted monotonically — whenever newer than the current record. Fixes
  the "force-compile, check timestamp, retry" agent loop where
  `compile-status` reported an old timestamp despite Unity having
  re-compiled.

### Changed
- **Dreamer CLI reference moved from slash command to Claude Code skill.**
  The reference now lives at `.claude/skills/dreamer/SKILL.md` (auto-loaded
  by Claude when Unity work appears) instead of `.claude/commands/dreamer.md`
  (user-invoked only via `/dreamer`). `./bin/dreamer update` migrates
  pre-existing installs — it removes the legacy file after copying the new
  skill. Fresh installs write only the skill.
- **SKILL.md prioritizes the synthesized `compile-status` fields.** New
  section at the top of the compile-status docs tells agents to read
  `body.status` + `summary` as source of truth rather than computing
  verdicts from raw `errors` / `lastSuccess` / `compiling` fields, plus a
  stop-retrying rule after two failed refresh-assets cycles. Mitigates the
  agent-loop pattern reported in Blackend Core use.

## [0.1.0-pre]

This section captures the major milestones since the initial commit on the
way to the first tagged release. Individual commit SHAs are listed for
reference.

### Added (major features since initial commit)
- Self-update via `./bin/dreamer update` + installer (`7ec1db7`)
- Project-local install model — no global npm link (`93d0ed0`)
- Project-local CLI wrappers in `bin/` (`4fafe7f`)
- Multi-project support: shared projects registry with port auto-allocation,
  HTTP 409 `wrong-project` enforcement, `probe-port` helper (`1cb9d1f` +
  follow-up work in recent main)
- Smart focus policy: stall-based fallback, tunable via
  `focusStallMs`/`--focus-after` (`9e2d71c`, `a7f0963`)
- Compile-error short-circuit + race-fix + stale-reason handling (`39deb0c`)
- Filesystem watcher + auto-refresh + global compile gate (`0a0c60b`)
- Stale asset-DB diagnostic hint for direct-written `.cs` files (`cfb9480`)
- Structured daemon logs (JSON lines) + colored TTY output (`d91a02d`)
- Command schema registry + daemon-side validation + `help` CLI (`dbdc2cb`)
- Scene/prefab feature parity, rename, duplicate, delete (`6198347`,
  `7f55857`)
- `create-hierarchy` for arbitrary-depth scene/prefab trees (`a1e00ce`)
- `remove-missing-scripts` for scrubbing orphan components after script
  deletion (single prefab, scene object, or folder scan; dry-run supported)
- `status` / `compile-status` with synthesized status enum
  (disconnected/unknown/compiling/errors/stale/idle/ok), per-timestamp ages,
  `queue.active[]` diagnostic view
- Scheduler observability (tick count, last-dispatch metrics) + stuck-running
  sweep timeout (default 60s, overridable per command)
- Scene-object path resolution: multi-scene, recursive, ambiguity detection
  (no more silent misroutes on name collisions)
- `set-property` struct/array support, including struct arrays, sparse
  updates (`{"_size":N,"0":...}`), nested structs, `self`/`selfChild` and
  component-override references
- Config file (`daemon/.dreamer-config.json`) + source tracking
  (`daemon/.dreamer-source.json`) for self-update drift detection
- 44-test daemon test suite (`44fe886`)
- macOS compatibility notes (`d0795ed`)
- Daemon README + branded console logs (`256af5e`)

### Architecture
- Three-layer design: CLI → Node.js daemon (localhost HTTP) ← Unity C#
  bridge (polling client)
- Daemon survives Unity domain reloads; Unity re-attaches on boot
- CLI auto-starts daemon on first invocation
