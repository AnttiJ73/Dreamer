# Changelog

All notable changes to Dreamer. Format roughly follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/).

Until the first tagged release, `main` is the live reference. After `v0.1.0`
tags, breaking changes bump the minor version (0.x.0), fixes bump patch.

## [Unreleased]

### Added — `delete-asset` command

`./bin/dreamer delete-asset --asset PATH_OR_GUID [--trash] --wait` routes through `AssetDatabase.DeleteAsset` (or `MoveAssetToTrash` with `--trash`) so deletions go through Unity's code path — SourceAssetDB stays consistent, activity log records the action, and `.meta` files are cleaned up automatically. Avoids the OS-level `rm` workaround that bypassed AssetDatabase.

### Added — `duplicate --save-path FOLDER` for asset mode

Asset-mode `duplicate` no longer forces the copy into the source folder. Pass `--save-path Assets/SomeOther/Folder` to land the duplicate elsewhere. Folder must exist under `Assets/` or `Packages/` (validated via `AssetDatabase.IsValidFolder`). Scene mode (`--scene-object`) ignores the flag — duplicates still land next to the source GameObject.

### Added — `capture-particle --scene-object PATH` (scene-source particle capture)

Capture-particle no longer requires a prefab. Pass `--scene-object PATH` to clone a live scene GameObject into the sandbox PreviewRenderUtility scene and capture there. The live scene object is **never touched, never flickers** — Unity's `Instantiate` deep-clones the subtree (including any component overrides currently live in the scene) into a `HideAndDontSave` instance that's destroyed after the capture. Round-trip workflow: `set-particle-property --scene-object … → capture-particle --scene-object … → read grid PNG → repeat` without ever exporting to a prefab. Result includes `source: "scene" | "asset"` plus the original `sceneObjectPath` for traceability.

### Fixed — `set-property` on integer-valued enum field writes the **value**, not the declaration ordinal

`SerializedProperty.enumValueIndex` is a 0-based ordinal into `enumNames` — for enums with non-sequential values (e.g. `= 18` after a deleted `= 2` entry), writing index 18 actually stored the underlying enum value at index 18 (which was 19, drift+1 per gap). Switched the numeric write path to `sp.intValue` which stores the actual integer; for gap-free enums the two coincide, for enums with gaps the value is now correct. String-name path (`--value "EnemySpawn"`) unchanged — it already used the name lookup.

### Changed — Unknown-command-kind error now hints at the `animation` and `fx` add-ons

`Unknown command kind '<kind>' [unity-bridge]` already pointed at `ugui` / `sprite-2d` installs for those add-on's kinds; now it also recognises animation kinds (`create_animation_clip`, `add_animator_state`, `create_animator_override_controller`, all 28 animator/clip/mask kinds) and fx kinds (`capture_particle`, `setup_particle_material`) — so downstream agents who hit the error get `Run: ./bin/dreamer addon install animation` instead of guessing the addon name.

### Changed — `set-property --help` line surfaces sparse-list syntax

Top-level help now mentions the sparse `{"_size":N,"<idx>":val}` form for list append / single-index update. The full schema (`help set-property`) already documented this in pitfalls + examples; the discoverability gap was the bare usage line.

### Fixed — Bridge + daemon now opt out of Windows EcoQoS power throttling

Win11 22H2+ aggressively throttles unfocused processes — the .NET ThreadPool timers that drive the bridge's heartbeat/poll/state ticks stall under load even though they live off the Unity main thread, and the daemon's Node event loop slips behind under multi-instance contention. End result: the daemon flags Unity as disconnected after ~25s without heartbeat, even though nothing has actually crashed (one such event is in the daemon log: `2026-05-09T15:02:02 disconnected after 25.2s without heartbeat`).

Both processes now call `SetProcessInformation(ProcessPowerThrottling)` with `EXECUTION_SPEED` opt-out:
- **Bridge:** `Packages/com.dreamer.agent-bridge/Editor/Core/WindowsProcessQoS.cs`, invoked from `BackgroundBridge.Start`. Idempotent across domain reloads.
- **Daemon:** `daemon/src/windows-qos.js` shells out to a tiny PowerShell helper at `server.listen` time (Node has no direct kernel32 binding and the daemon stays at zero npm dependencies). Fire-and-forget — daemon is functional whether the call succeeds or not.

Generic across Unity versions (kernel32 only) and across Windows versions (no-ops cleanly on pre-1709 Windows). On macOS / Linux: silent no-op, no behavior change. Watch for `windows-qos: Disabled Windows EcoQoS for daemon process …` in `daemon/.dreamer-daemon.log` to confirm the daemon-side opt-out succeeded.

### Changed — Unity-disconnect timeout 10s → 25s; stale-state-clear 30s → 60s

When 3+ CLI clients hammer the same daemon (multi-agent workflow) AND Unity is unfocused on Windows (main thread throttled), transient blips can push more than 3 heartbeat windows past the deadline even though the bridge is still alive. The old 10s disconnect timeout flagged Unity as gone after ~3 missed heartbeats; the bridge would reconnect on the next successful POST but commands queued in the gap saw "unity_disconnected" reasons.

New defaults:
- **Disconnect timeout: 25s** (~8 missed heartbeats at the bridge's 3s send interval). Tolerates short stalls under multi-client contention without hiding actual Unity quits.
- **Stale-state clear: 60s** (was 30s). Same rationale — the cached compile/play-mode/error state cleared too eagerly.

The daemon now also logs the connect/disconnect transition with the actual elapsed time, so the post-mortem can tell "real disconnect" from "transient blip just past the threshold."

### Fixed — `Infinity` literals in Unity-side material data no longer break the daemon parser

Unity's SimpleJson serializer emits `Infinity` / `-Infinity` / `NaN` literally for non-finite floats, but those tokens aren't valid JSON. Materials with vector defaults that include `Infinity` (e.g. `_CameraFadeParams: (0, Infinity, 0, 0)` on Particles/Standard Unlit) caused the daemon's `JSON.parse` to fail silently, leaving the result as an unparsed string and producing double-encoded CLI output. Daemon now retries the parse with `Infinity` → `1e999` and `NaN` → `null` when the first attempt fails — round-trips back to JS Infinity / null, so values aren't lost. CLI output also handles the residual string-result case rather than re-stringifying.

### Added — `daemon/test/parity-diff.js` — Node vs Unity output equality regression

Runs each Node-migrated read command twice (once Node-path, once `--unity` Unity-path) and asserts the JSON outputs match modulo a documented ignore list (instanceId, lastModified sub-second, ProjectSettings file ordering). Catches structural divergence the unit/CLI tests can't because they don't exercise both paths. 14/14 pass.

Driving this surfaced and fixed a batch of real shape mismatches: `inspect-hierarchy` now wraps prefab/scene results in the `{assetPath, guid, source, root}` envelope Unity emits; `inspect-project-settings` includes built-in tags + `physics3D` / `physics2D` / `files`; `inspect-player-settings` returns enum strings (`"FullScreenWindow"` instead of `1`, `"NET_Standard_2_0"` instead of `6`) matching Unity's API; `inspect-material` now stays on the Unity path entirely (the shader-property metadata it returns requires `ShaderUtil` which has no YAML equivalent); PackageCache assets are walked + re-pathed to their logical `Packages/com.foo/...` form so `find-assets` counts match Unity.

### Added — Node-side asset readers (Lever 3): inspect_asset / find_assets / inspect_material / inspect_animation_clip / inspect_animator_controller / inspect_avatar_mask / inspect_animator_override_controller / inspect_shader / inspect_build_scenes / inspect_project_settings / inspect_player_settings now run pure-Node by default

A subset of read-only commands now read Unity asset YAML directly from disk in the CLI process, skipping the daemon→Unity round-trip entirely. They work with **Unity unfocused, compiling, or even closed**. Local tests show ~115-150ms end-to-end (the floor is Node startup), vs 100ms-2s+ when going through Unity, *and* they no longer block on Unity's main-thread availability.

**What's covered:**
- `find-assets` — built from a `.meta` scan of `Assets/` + `Packages/`. Type filter (`prefab`, `material`, `texture`, etc.) maps to the resolved importer/extension type. Path + name filters work. Folder-not-found errors surface the same way as the Unity path.
- `inspect` (asset target) — `.prefab` walks GameObject/Transform docs and resolves component types via class IDs + script-GUID lookups. Built-in MonoBehaviours (CanvasScaler, GraphicRaycaster, Image, …) resolve via a lazy `Library/PackageCache` index extension.
- `inspect-material` — shader ref + textures + floats + colors + ints, all from the `.mat` YAML.
- `inspect-animation-clip` — float/object/position/rotation/euler/scale curves, sample rate, length.
- `inspect-animator-controller` — layers, parameters, state/transition/state-machine counts.
- `inspect-avatar-mask`, `inspect-animator-override-controller`, `inspect-shader`, `inspect-build-scenes`, `inspect-project-settings`, `inspect-player-settings` — all read directly from their YAML.
- `inspect-many` — same prefab/scene logic in bulk.

**Fallback design.** Each command tries Node-side first. On any error (parse failure, prefab variant detected, scene-with-prefab-instances detected, or `includeFields=true` which still needs Unity's SerializedProperty enumeration), it transparently falls back to the daemon→Unity path. Pass `--unity` to force the Unity path for regression / debugging. Set `DREAMER_DEBUG_NODE_INSPECT=1` to log fallback reasons to stderr.

**Output shape.** Identical to the Unity-side handlers in every covered case, with two documented differences: `instanceId` is the YAML fileID (a stable per-asset identifier — Unity-side returns `GameObject.GetInstanceID()` which is a runtime-only number). `enabled` is conservative (true unless the YAML explicitly has `m_Enabled: 0` on a class with that field).

**`inspect-hierarchy`** also runs Node-side when given a `--asset PREFAB` or `--scene PATH-TO-UNITY-FILE`. The bare `--scene NAME` form still requires Unity (resolving a scene NAME to a loaded scene is a runtime concept — there's no on-disk index of "scenes Unity has currently open").

**What's NOT covered (Unity path still required):** scene-object reads (`--scene-object` form — runtime state, no YAML alternative), `read_property` (still uses Unity's SerializedProperty resolver), `sample_animation_curve` (Hermite spline math TBD), `inspect_hierarchy --scene NAME` (resolves Unity-loaded scenes by name), `inspect-shader --shader NAME` (Shader.Find lookup), prefab variants (detection-only — falls back), `--include-fields` (SerializedProperty enumeration).

Implementation lives in `daemon/src/unity-yaml/` with these modules:
- `parse.js` — Unity-flavored YAML parser (multi-doc, flow-map line-wrap, plain-scalar fold, YAML 1.1 string escapes).
- `asset-index.js` — GUID ↔ path ↔ type index built from `.meta` scan of `Assets/` + `Packages/`. Lazy-extends to `Library/PackageCache` on first script-resolver miss.
- `script-resolver.js` — script GUID → class name (incl. namespace), via a small C# scanner that strips strings/comments and finds the most-likely class declaration.
- `class-ids.js` — Unity persistent class IDs → type name.
- `inspect.js` + `inspect-typed.js` — the actual inspectors.
- `inspect-project-settings.js` — Build / project / player / single-key settings.

Regression tests in `daemon/test/`:
- `yaml-sweep.js` — parses every YAML asset under `Assets/`, `Packages/`, `ProjectSettings/` (64/65 in this repo, 1 binary skipped).
- `node-inspect-sweep.js` — runs every Node-side inspector against real project assets (38/40 here; 2 are scenes-with-prefab-instances and correctly return the fallback signal).

### Changed — CLI is now `--wait`-by-default, output stripped to the result body

The CLI used to default to fire-and-forget: every command had to be passed `--wait` to actually finish before the CLI returned, and forgetting it produced a half-baked queue envelope. New defaults:

- **`--wait` is now the default.** Pass `--no-wait` for the rare async case (commands that intentionally outlive the CLI process). Existing `--wait` flags are accepted as no-ops, so old scripts and schema examples keep working.
- **CLI output is the `result` body**, not the queue envelope. The 14-field `{id, kind, args, state, requirements, dependsOn, priority, allowPlayMode, createdAt, updatedAt, dispatchedAt, completedAt, result, error, attemptCount, originTaskId, humanLabel}` envelope was queue/scheduler internals — none of it changed what an agent did next. Pass `--verbose` to recover the full envelope for debugging.

### Added — `dreamer batch` for one-shot multi-command runs

`./bin/dreamer batch --file ops.json` (or stdin) accepts a JSON array of `{kind, args, options?}` items and runs them sequentially in one CLI process. Each command pays the daemon HTTP round-trip but only ONE command pays Node startup (~80-150ms on Windows). For chains of property edits this saves (N-1) × Node startup — a 10-op tuning batch goes from ~1.5s of Node spin-up to ~150ms. Stops at the first failure unless `--stop-on-error=false`. Returns `{ok, count, total, results: [{index, kind, ok, result|error}, ...]}`.

### Added — `dreamer prewarm` + SessionStart hook

`prewarm` ensures the daemon is running and exits silently. The project's `.claude/settings.json` SessionStart hook now calls it alongside `update --check`, so the daemon is already listening when Claude submits its first command. Cold daemon start cost is paid before the agent ever waits on it. ~135ms total (cold daemon start + Node startup); near-zero if the daemon is already up.

### Changed — `dreamer search` output stripped to actionable fields

The search response no longer includes `score`, `matchedOn`, or `pass` (per-result *or* top-level). These were internal ranking signals that didn't change which tool an agent picked or how it called the tool. Each result is now just `{kind, cliVerb, summary, firstExample}` — roughly half the byte count.

A top-level `kinds: "name1, name2, ..."` comma-separated string is now emitted *before* `results`, so an agent that only reads the first ~20 lines of the JSON sees every match name before the verbose summaries push them out of view. This was the original failure mode: long descriptions on the top match caused later (often more relevant) matches to be missed.

### Added — `generate-texture` edge-clipping detector

`generate-texture` and `regenerate-texture` now scan the 1-pixel border of every rendered PNG and emit `result.warnings[]` + `result.edgeAlpha` when alpha > 8/255 anywhere on the boundary. This catches the most common particle-texture mistake: a radial gradient with `to: [W, H]` (corner), which leaves the *edges* sitting at offset ≈ 0.71 — partially opaque — so the texture shows hard square clipping under rotation or scaling. The warning quotes the exact safe-radius for the texture size and a corrected `from`/`to` example. `generate_texture` schema pitfalls now spell out the rule (`to` distance ≤ `min(W,H)/2 - 4`).

### Added — `generate-sheet` + `regenerate-texture` + hand-drawn outline jitter (Phases 3-5)

Three companion features to `generate-texture` that complete the texture authoring loop:

**`generate-sheet`** — composes a sprite-sheet from N tile renders. Two modes:
- **Animation**: provide a `base` tile spec + `interpolate: { "layers[0].radius": [5, 25] }` and the builder generates `frames` tiles by linearly interpolating values across frames. Numbers and hex colors interpolate channel-wise; arrays element-wise. Property paths use `lodash`-style: `layers[0].radius`, `layers[2].center[0]`, `background`. Typos throw at render time.
- **Explicit**: provide `tiles: [tileSpec, tileSpec, ...]` for a hand-built grid (different shape per tile — useful for icon strips).

```bash
./bin/dreamer generate-sheet --inline-spec '{"tileSize":[64,64],"cols":2,"rows":2,"frames":4,"background":"#00000000","base":{"layers":[{"type":"shape","shape":"circle","center":[32,32],"radius":5,"fill":"#FFEE00","stroke":{"color":"#222","width":2}}]},"interpolate":{"layers[0].radius":[5,25],"layers[0].fill":["#FFEE00","#FF2200"]}}' --out Assets/Textures/puff.png
```

Result includes per-tile metadata (`{ index, col, row, x, y, w, h }`) so a follow-up `slice-sprite --grid` knows the exact pixel positions.

**`regenerate-texture`** — the iteration loop verb. Reads a spec file whose `out` field points at the texture path, re-renders, auto-runs `refresh-assets` so Unity reimports immediately. Workflow: edit `Assets/_DreamerTextures/specs/foo.json`, run `./bin/dreamer regenerate-texture --spec foo.json`, Read the resulting PNG, repeat. No need to re-pass `--out` or `--refresh` on every cycle.

**Hand-drawn outline jitter** on shapes:
- `stroke.jitter: { amount, scale, kind?, seed?, octaves? }` — wobbles JUST the outline around a clean fill (like a shaky pen line over a printed shape).
- `displace: { amount, scale, kind?, seed?, octaves? }` on a shape layer — wobbles the whole SDF, so fill AND outline drift together (like a freehand drawing where everything boils a little).

Both are noise-displaced SDF distances, so they compose with anti-aliasing and outline width naturally. Default kind is `value` noise; `perlin` and other kinds in the noise module work too. Use `octaves` > 1 for more organic variation.

```jsonc
{ "stroke": { "color": "#221100", "width": 3, "jitter": { "amount": 1.5, "scale": 0.18, "seed": 7 } } }
{ "displace": { "amount": 4, "scale": 0.12, "octaves": 2, "seed": 5 } }
```

Verified visually via `daemon/scripts/sheet-smoke.js`: a 2×2 animated puff (radius+color+alpha keyed across 4 frames), an explicit-tile icon strip (circle, star, plus, hexagon), a circle with shaky outline, a yellow square with whole-shape wobble, and a 4-frame growing-star animation that combines stroke jitter + whole-shape displace + size interpolation. All under 15 ms each.

### Added — `generate-texture` (Phase 2): procedural PNG rendering, no Unity round-trip

New CLI verb that renders a layered JSON spec straight to a PNG on disk. Pure Node — no daemon round-trip, no Unity round-trip, runs while Unity is unfocused or compiling. Output lands wherever you point `--out`, typically under `Assets/Textures/...` so a subsequent `refresh-assets` (or `--refresh` flag) imports it.

```bash
./bin/dreamer generate-texture --inline-spec '{"size":[128,128],"background":"#00000000","layers":[{"type":"shape","shape":"circle","center":[64,64],"radius":50,"fill":"#FF8800","stroke":{"color":"#000000","width":4}}]}' --out Assets/Textures/orb.png
./bin/dreamer generate-texture --spec Assets/_DreamerTextures/specs/sunset.json --out Assets/Textures/sunset.png --refresh
```

**Layer types**:
- `solid` — full-buffer fill with a color.
- `gradient` — `linear` or `radial`, multi-stop, with offset interpolation.
- `shape` — `circle`, `rect` (rotated, optional corner radius), `polygon` (regular n-gon), `star` (configurable inner/outer radius + point count), `plus`, `line` (capsule with thickness). Anti-aliased fills via SDF + smoothstep over a 1-pixel band. Optional outline with `width`, `color`, and `position: centered|outside|inside`.
- `noise` — `white`, `value` (lattice with bilinear interp + smoothstep), `perlin` (gradient noise), `voronoi` (cellular F1, with `euclidean`/`manhattan`/`chebyshev` metrics). All deterministic from `seed`, with optional `octaves` + `persistence` for fractal stacking. Tinted via `color` + `lo`/`hi` value remap.

**Blend modes** per layer: `normal` (alpha-over), `add`, `multiply`. Per-layer `alpha` multiplier.

**Color formats** accepted everywhere: `#RGB`, `#RGBA`, `#RRGGBB`, `#RRGGBBAA`, `{ r, g, b, a }` with 0..1 floats, or `[r, g, b, a]` with 0..255 ints.

**No deps** — built-in `zlib` for PNG encoding, hand-rolled CRC table, hand-rolled deflate-friendly raster. ~5–30ms for a 256×256 with several layers (the four samples in `daemon/scripts/texture-smoke.js` all complete under 30ms).

**Phase 2 of the user-requested feature set.** Phases 3–5 (hand-drawn outline jitter, more blend modes, sheet builder + animation tiles, regenerate-from-saved-spec iteration loop) are queued as separate commits — the renderer is structured to absorb them without rewrites.

### Added — `setup-particle-material` + `capture-particle --auto-material`

New command in the `dreamer-fx` add-on that closes the "particles invisible / magenta" gap on freshly-created particle prefabs. `setup-particle-material --asset Path.prefab` walks every `ParticleSystemRenderer` in the prefab subtree and assigns a placeholder material (created at `Assets/Materials/{prefabName}_Particle.mat` with a particle-friendly Unlit shader, white tint, additive blend) when a renderer has none. Existing materials are preserved unless `--force` is passed.

```bash
./bin/dreamer setup-particle-material --asset Assets/FX/Explosion.prefab --wait
./bin/dreamer setup-particle-material --asset Assets/FX/Fire.prefab --color "#FFAA22" --texture Assets/Textures/flame.png --blend additive --wait
./bin/dreamer setup-particle-material --asset Assets/FX/Spark.prefab --shader "Sprites/Default" --force --wait
```

`capture-particle` also gains a `--auto-material` flag: if any PSR has no material, it runs the same setup before capturing so the agent doesn't get a black square back from a brand-new prefab.

- Shader fallback chain (when `--shader` is omitted): `Particles/Standard Unlit` → `Universal Render Pipeline/Particles/Unlit` → `HDRP/Particles/Lit` → `Sprites/Default`. First hit wins.
- Blend mode presets: `--blend additive|alpha|multiply|opaque`. Sets `_Mode` plus the corresponding `_SrcBlend`/`_DstBlend`/`_ZWrite`/render queue + shader keywords for built-in particle shaders, or `_Surface`/`_Blend` for URP.
- `--force` replaces an already-assigned material; default is no-op when one exists.
- Color via `--color "#RRGGBB"` or `"#RRGGBBAA"`. Tries `_TintColor`, `_BaseColor`, `_Color` in turn (whichever the shader exposes).

### Changed — `capture-particle` GIF now has timestamps + plays at exact realtime

GIF frames are now extended with the same `t=X.XXs` label strip the grid cells use, burned into the top of each frame canvas. The animation tells you how the effect develops over absolute time, not just shape order. Useful for tuning emission timing (e.g. "the burst should peak at t=0.3s, but the GIF shows the peak landing at t=0.5s — bump emission rate up").

Also fixes a 10% playback drift: the previous delay calculation used `duration / (frames - 1)` so a 5s 10-frame capture played back in 5.5s. Now uses `duration / frames` so total cycle = duration exactly. Override with `--gif-delay-ms` if you want a different speed.

### Added — `capture-particle` emits an animated GIF alongside the grid PNG

`capture-particle` now writes an animated GIF in addition to the static grid composite, so you can actually watch the effect play instead of only diffing still frames. Defaults: GIF on whenever `frames >= 2`, frame delay derived from `duration / (frames - 1)` so the loop spans the same simulated time as the capture, infinite loop, single global 256-color palette via median-cut quantization. Result includes `gifPath` and `gifByteCount`.

```bash
./bin/dreamer capture-particle --asset Assets/FX/Explosion.prefab --frames 10 --wait
# Writes: particle-…-grid.png  +  particle-….gif
./bin/dreamer capture-particle --asset Assets/FX/Boring.prefab --no-gif --wait    # opt out
./bin/dreamer capture-particle --asset Assets/FX/Slow.prefab --gif-delay-ms 200 --wait
```

- New flags: `--gif | --no-gif`, `--gif-delay-ms <int>`, `--gif-loop <count>` (0 = infinite).
- New result fields: `gifPath`, `gifByteCount` (only set when GIF was emitted).
- Self-contained GIF89a encoder lives in the `dreamer-fx` add-on (`Encoders/GifEncoder.cs`) — no external dependencies. Median-cut quantization to a single global 256-color palette + LZW compression with the standard sub-block format.

### Fixed — Animated GIF from `capture-particle` was truncated to 1/8 of each frame's pixels

Symptom: the GIF wrote successfully, but most image viewers either rendered junk or refused to open it; `gif-inspect.js` showed each frame decoded to 32768 pixels instead of 262144 (8× short). Root cause: classic GIF LZW off-by-one in the encoder's `codeSize` bump check — the encoder increased the code width one iteration too early because the decoder's dictionary trails the encoder's by one entry (decoder's first-code branch adds nothing to the table). Encoder wrote a 10-bit code while the decoder was still reading 9 bits, mis-aligning the bitstream and tripping the End code (257) prematurely.

Fix in [GifEncoder.cs](Packages/com.dreamer.agent-bridge.fx/Editor/Encoders/GifEncoder.cs): change the bump trigger from `nextCode >= (1 << codeSize)` to `nextCode > (1 << codeSize)`, matching giflib's ordering and the JS reference decoder used by `daemon/scripts/gif-inspect.js`. Verified by round-tripping six payloads (zeros, alternating, counting 0..255 — exactly the dictionary-fill stress case — repeated counting, 262144 zeros, 262144 pseudo-noise) through a JS port of the encoder back through the decoder; all six match byte-for-byte after the fix and fail before it.

### Added — `capture-particle` command + `dreamer-fx` add-on (visual VFX iteration)

Closes the visual-feedback gap for particle iteration: an LLM editing `ParticleSystem` properties can now SEE how the effect looks at each timestamp instead of guessing. `capture-particle --asset FX.prefab` spawns the prefab into a sandboxed `PreviewRenderUtility` scene, runs `ParticleSystem.Simulate(t, fixedTimeStep=true, restart=true)` at N evenly-spaced timestamps (or explicit `--times "[0, 0.05, 0.5, 1.0]"`), and composes all frames into **one grid PNG** with timestamp labels above each cell. The user's active scene is untouched.

```bash
./bin/dreamer capture-particle --asset Assets/FX/Explosion.prefab --frames 10 --seed 42 --wait
# Returns result.path → ONE PNG, 5×2 grid, every cell labelled "t=X.XXs". Read it.
```

Iteration loop: `set-particle-property` → `capture-particle --seed 42` → Read the grid PNG → judge → repeat. The fixed seed makes diff-by-eye productive — re-capturing after a tweak shows ONLY what your edit changed, not random emission noise.

- **Grid composite by default.** All N frames in one image, left-to-right top-to-bottom, with `t=X.XXs` labels (rendered via inline 5×7 bitmap font for self-containment). Layout heuristic: 5 frames → 3×2, 7-8 → 4×2, 10 → 5×2, otherwise near-square. `--individual-frames` opts in to also dumping per-frame PNGs.
- Two-pass camera framing: simulate at every sample time first to compute the union of `Renderer.bounds` across all frames, then position the camera so no frame's particles fall outside view (a frame where particles spread far doesn't push earlier frames offscreen).
- Sub-emitter chains and trail Renderers are included in bounds and rendering. `Simulate(withChildren=true)` is called on top-level PS roots so birth/death events drive sub-emitters correctly.
- `--frames N` (default 5, 1..60), `--duration SEC` (default = root system's `main.duration`, fallback 2.0s for loops), `--times "[…]"` for non-uniform sampling, `--angle front|iso|top|...`, `--size WxH` per cell (up to 4096), `--bg "#RRGGBB"` or `--transparent`, `--seed N` for reproducible RNG, `--individual-frames` for per-frame PNGs.
- Asset-only in Phase 1 (prefab path). Scene-object capture and VFX Graph (`UnityEngine.VFX.VisualEffect`) deferred to a future phase.
- Ships as the new `com.dreamer.agent-bridge.fx` add-on. Install via `./bin/dreamer addon install fx`. New `dreamer-fx` skill auto-loads on particle / VFX tasks. Search keywords: particles, vfx, effect, explosion, spark, trail, burst, simulate.
- Verified end-to-end on a freshly-created ParticleSystem prefab: 10-frame grid renders cleanly with label strips, particles progress deterministically t=0.00s → t=2.00s.

### Fixed — Bridge timed out connecting to daemon on Windows (IPv4/IPv6 mismatch)

Symptom: Unity Editor logged `[Dreamer] Background bridge error: The operation has timed out.` repeatedly. `./bin/dreamer status` reported the bridge as disconnected even though Unity was open and focused. Commands queued indefinitely with `waitingReason: "unity_disconnected"`. `netstat -an | findstr <port>` showed `0.0.0.0:<port> LISTENING` plus several `[::1]:NNNN -> [::1]:<port> SYN_SENT` lines that never advanced.

Root cause: the daemon called `server.listen(port, '0.0.0.0', …)` — IPv4 only — while the Unity bridge built its base URL as `http://localhost:{port}`. On Windows, `localhost` resolves to `[::1]` (IPv6) first for many configurations. The bridge's heartbeat opened an IPv6 socket that hung in `SYN_SENT` until UnityWebRequest's timeout elapsed.

Two complementary fixes (belt-and-braces — either alone resolves it):

- **Daemon**: bind dual-stack — `server.listen(port, '::', …)` instead of `'0.0.0.0'`. Node accepts both stacks on `'::'`. `isLocalhost()` already whitelists `127.0.0.1`, `::1`, and `::ffff:127.0.0.1`, so the auth check is unchanged.
- **Bridge**: hardcode `BaseUrl = "http://127.0.0.1:{Port}"` instead of `localhost`. Removes the resolver dependency entirely so connections are deterministic across host configurations.

Reported by @AnttiJ73 from a downstream project (Endless Depths) — patches were applied locally there first; this brings them upstream so `./bin/dreamer update` picks them up.

### Changed — `dreamer search` now indexes per-kind topic keywords + a 4× larger synonym map

The synonym map grew from 17 word-groups (~50 entries) to ~70 word-groups (~250 entries) — covers create / delete / inspect / find / move / save / play / compile / wire / animate / atlas / ui / physics families with symmetric cross-links. New per-kind `KIND_KEYWORDS` map attaches topic tags directly to the right kinds so a query lands name-tier:

- `ppu` / `pixelsperunit` / `filtermode` / `isreadable` / `wrapmode` / `maxtexturesize` / `texturetype` → `set-import-property`
- `atlas` / `spritesheet` / `tileset` / `tile` / `cell` / `islands` / `subsprite` → `slice-sprite`
- `playmode` / `runtime` / `start_game` / `simulate` → `set-play-mode`
- `hud` / `canvas` / `menu` / `panel` / `gui` / `button` → `create-ui-tree`
- `controller` / `fsm` / `statemachine` → `create-animator-controller`
- `blendtree` / `mix` → `add-animator-blend-tree`
- `wire` / `connect` / `link` / `reference` / `assign` / `serialized` → `set-property`
- `verify_shader` / `pink` / `gpu_error` → `shader-status`
- `verify_compile` / `csharp` / `syntax` → `compile-status`
- … plus animation / mask / icon / build-scene / sorting-layer / cursor topic tags.

Verified end-to-end: `verify shader` → shader-status (was → validate-sprite); `find prefab` → find-assets (was → inspect-hierarchy); `playmode` / `run the game` / `exit playmode` → set-play-mode; `atlas slice` / `spritesheet` / `tile slicing` → slice-sprite; `tint material` → set-material-property; `extract prefab` → save-as-prefab; `kill object` / `destroy gameobject` → delete-gameobject; `fork asset` → duplicate. 8/8 prior-commit regression queries still pass — new keywords broaden coverage without disrupting precise hits.

Conservative on truly ambiguous tokens — `set`, `key`, `type`, `value`, `name`, `tree`, `asset`, `go` deliberately have no synonym entry to avoid flooding multi-token queries.

### Added — `dreamer-sprite` skill + skill discovery routes through `search`

- New auto-loading skill at `.claude/skills/dreamer-sprite/SKILL.md` covering the sprite-2d add-on (preview-sprite / slice-sprite / extend-sprite / validate-sprite / set-import-property). Documents the four authoring modes (`grid`, `auto`, `rects`, `merge`), the four-pass extend recovery (IoU → candidate template → coherent-motion → brute-force), the eight auto-validation checks with their `suggestedRect` / `suggestedName` / `suggestedFix` fields, and the `isReadable=true` prerequisite. Activates on mentions of sprite sheet, atlas, slicing, PPU, pixels per unit, filter mode, pivot, or composite sprite.
- `dreamer-sprite` and `dreamer-ugui` skills now ship as part of `./bin/dreamer addon install <name>` (mirrored to the project alongside the package), and are pulled by `./bin/dreamer update` whenever the corresponding add-on is installed. Add-on installs also stamp a CLAUDE.md section so future Claude sessions know the add-on exists without having to re-discover it.
- The core `dreamer` skill now leads with **`./bin/dreamer search "<free-text>"`** as the default discovery interface — replaces the old "list all kinds via `help`" guidance. `tasks.md` gains a top-row `search` entry and a full Sprite-sheet authoring section. `dreamer-ugui` skill links to `search` for verb lookup.
- Closes a documented LLM failure mode: search shipped a release ago but the skill files still told Claude to use `help`, so the new tool was effectively invisible to agents.

### Added — `dreamer search` (default discovery interface)

Schema-aware command discovery. Closes a real LLM failure mode: agents constructing names like `duplicate-asset`, `copy-prefab`, or `duplciate` (typo) would conclude the feature was missing when the actual verb is `duplicate`. Search across:

- Verb names (kebab-case CLI form, snake-case kind, hand-curated aliases)
- Schema summaries
- Arg names + descriptions
- Example CLI lines
- Pitfall text

Two-pass ranking: a precise pass with synonym + stem expansion (`copy↔duplicate`, `clone↔duplicate`, `remove↔delete`, `show↔inspect`, etc., plus `-s` / `-ed` / `-ing` stem stripping). If the precise pass returns fewer than 10 results, a broad pass kicks in with widened Levenshtein (≤3 vs ≤2), character-trigram similarity, and the zero-token-penalty disabled — "very loose" criteria so vague queries always surface ≥10 candidates when possible. Each result is tagged `pass: 'precise' | 'broad'` so the caller knows the confidence level.

- **`dreamer search <query>`** — top-level discovery (`dreamer search "copy prefab"`, `dreamer search ppu`, `dreamer search "set ppu"`).
- **`dreamer help <unknown>`** falls back to search instead of dumping the full kind list. `dreamer help duplicate-asset` now returns `duplicate` as top match with score + match reasons.
- **Daemon-side `Unknown command kind` errors** now include a `suggestions[]` field with the top 5 fuzzy matches — the bridge surfaces these directly to the caller.

Each result includes a `matchedOn[]` list so the LLM sees *why* something matched (`'copy'→'duplicate' name 'duplicate' exact`, `'prefab' summary word`, etc.) — match-reason transparency lets the LLM judge confidence without re-running.

### Added — Auto-validation on every sprite-sheet operation

Each sprite-sheet command now runs eight sanity checks against the post-operation state and attaches a `validation: { ok, summary, count, warnings[] }` field to the result. Surfaces issues an LLM would otherwise discover by trial-and-error round-tripping through preview-sprite.

- **error**: `out_of_bounds` (rect extends past texture), `duplicate_name` (ambiguous lookups).
- **warn**: `empty_rect` (zero opaque pixels — stale after art deletion), `partially_clipped` (boundary cuts through opaque content — sprite extends past rect), `orphan_pixels` (opaque-pixel islands ≥64 pixels not inside any rect — content forgot to slice).
- **info**: `overlap` (intentional for merge-bbox composites), `low_density` (<5% opaque), `tiny_rect` (<4px on a side).

For three kinds the validator pre-computes the fix so the LLM doesn't have to re-scan the pixels:
- `partially_clipped`: flood-fills from inside-edge content to find the sprite's true bbox → emits `suggestedRect` + plain-text "Widen to …".
- `low_density`: scans the rect for the opaque-pixel bbox → emits `suggestedRect` + "Tighten to …".
- `orphan_pixels`: detects the dominant `<prefix>_<N>` naming pattern from existing rects, picks the next index → emits `suggestedRect` + `suggestedName` + "Add rect … named …".

`validate-sprite --asset PATH` runs the same checks on demand for assets the agent didn't author. Auto-attached on `slice-sprite` / `extend-sprite` / `slice-sprite --mode merge` results.

Bug fix incidental: `ApplySpriteRects` no longer throws on duplicate-named existing rects (now keeps the first spriteID seen and lets validation report the duplicate).

### Added — `extend-sprite` (sprite-sheet edit-without-breaking-references)

Extends a sliced sheet without losing existing rect names or `spriteID`s — protects every prefab, animation, and Animator reference that depends on those names. Four-pass orphan recovery, applied in order of cost:

- **Pass A (IoU):** auto-detects islands in the current sheet, IoU-matches them against existing rects. Handles "artist added new sprites in unused whitespace" — original rects keep their names, ID, alignment; positions snap to the candidate island's exact bounds.
- **Pass B (candidate-restricted template match):** for unmatched existing rects, pixel-matches the cached pre-edit content against current islands of similar size (±10%). Handles single-sprite relocations.
- **Pass C (coherent-motion guess):** computes median (dx, dy) across all successful matches; for remaining orphans, tests `oldPos + medianDelta`. Catches sprites that don't fit the size band but moved with the rest of the sheet (e.g., merged-bbox composite rects that span multiple islands — the case where the previous candidate-restricted approach fell through).
- **Pass D (brute-force scan):** for any still-unmatched orphan, slides the template across all positions with sample-pixel early-exit (~150k positions on a 1024×600 sheet, sub-second). Tie-breaks by proximity to the median-delta hint to avoid arbitrary picks on repetitive content (tilesets).
- **Unmatched islands** appended as new rects with next-available index (`<prefix>_<N>`).
- **Still-unmatched existing rects** reported as orphans (kept in place — agent decides).

Auto-cache: every successful slice / extend operation now writes per-rect PNGs to `Library/Dreamer/SpriteSlices/<assetGuid>/` keyed by `spriteID`. Invisible to the user, gitignored. This is what Stage 2 template-matches against. Cache rebuilds on the next slice/extend after a Library wipe.

Verified end-to-end on the test fixture by simulating a 200-pixel canvas resize WITH a merged-bbox rect (PostSplitTest spanning two islands): 15 sprites realigned via candidate template, 1 (the merged composite) realigned via coherent-motion at score 1.00, 0 orphans. Names + spriteIDs preserved across the resize.

Remaining limitations documented in the schema: sprites whose pixel content was actually redrawn fall through to orphan even with brute-force, since no position in the new sheet matches the cached pixels.

### Added — Sprite-sheet workflow (preview / slice / import settings)

- **NEW ADDON `com.dreamer.agent-bridge.sprite-2d`** — sprite-sheet authoring lives in its own package (mirroring the `ugui` and `animation` addons), so 3D-only projects don't compile sprite code or pull in `com.unity.2d.sprite`. Install via `./bin/dreamer addon install sprite-2d`.
- **`preview-sprite --asset PATH [--sub-sprite NAME] [--save-to PATH]`** *(addon)* — render a sprite (or one named sub-sprite from a sliced sheet) to PNG. Default for Multiple-mode sheets: full texture with colored rect outlines per sub-sprite, plus a `sprites[]` array mapping color→name. Open the resulting PNG with the Read tool to inspect slicing visually.
- **`slice-sprite --asset PATH --mode grid|auto|rects|merge [...]`** *(addon)* — author the spritesheet rects.
  - `grid --cell WxH [--padding x,y] [--offset x,y]`: regular tile slicing, skips fully-transparent cells.
  - `auto --min-size N`: connected-component scan via Unity's `InternalSpriteUtility.GenerateAutomaticSpriteRectangles`.
  - `rects --rects '[{name,x,y,w,h,...}]'`: explicit JSON.
  - `merge --groups '[{keep, absorb:[name1,name2,...]}]'`: combine existing rects into a union-bbox (for composite islands — e.g. character + shadow that auto-slice split apart).
  Auto-flips `spriteImportMode` to Multiple, preserves `spriteID` for name matches across re-slices (keeps prefab/animation references intact).
- **`set-import-property --asset PATH --property NAME --value JSON`** *(core)* — generic AssetImporter property setter (TextureImporter / ModelImporter / AudioImporter / etc.). Reflects on the importer subclass and auto-reimports. Closes the gap that `set-property` only reaches the runtime asset, not its importer. Common uses: `spritePixelsPerUnit`, `filterMode "Point"`, `textureType "Sprite"`, `isReadable true` (required before `slice-sprite --mode auto`). Stays in core because audio/model importers benefit too.
- `dreamer addon list` / `addon install` now also lists `animation` and `sprite-2d` (animation was previously installable only via manual git-clone — fixed in passing).
- Missing-addon hint expanded: trying `preview-sprite` / `slice-sprite` without the addon now returns "Run: ./bin/dreamer addon install sprite-2d", same pattern the ugui kinds already had.

### Added — Queue control + GameObject layer assignment

- **`cancel <id>`** / **`cancel --state STATE`** / **`cancel --task TASKID`** — cancel queued/waiting/dispatched/running commands. Single-id form for one command; bulk form flushes everything matching the filter (e.g. `cancel --state waiting` clears all Play-Mode-parked commands without exiting Play Mode). Daemon-side cancellation API existed but had no CLI surface.
- **`set-layer (--scene-object PATH | --asset PATH [--child-path SUB]) --layer NAME_OR_INDEX [--recursive]`** — assigns `GameObject.layer`. Layer names auto-resolve via `LayerMask.NameToLayer`; numeric indices accepted 0–31. `--recursive` mirrors Unity's "set children too?" Inspector prompt. `set-property --property m_Layer` now intercepts with a directive error pointing here (m_Layer lives on the GameObject anchor, not a Component — same pattern as `rename` for m_Name).
- Schema validator now accepts union types (`type: ['string', 'number']`) so commands like `set-layer` can document both name and index forms.

### Added — Animation tooling Phase 2 (15 commands across 5 areas)
Comprehensive animator authoring beyond the Phase 1 surface (create + add states/parameters/transitions). Phase 2 adds iteration safety, multi-layer controllers, blend trees, avatar masks, and override controllers — verified end-to-end.

**Iteration ergonomics — modify mistakes without recreating the controller**:
- `remove-animator-parameter --name X [--force]` — refuses by default if any transition condition references the parameter; `--force` removes anyway and reports `orphanedConditions` count.
- `remove-animator-state --name X [--layer N]` — removes the state and scrubs dangling incoming transitions on the source side.
- `remove-animator-transition --from STATE --to STATE [--layer N] [--index N]` — by ordinal among matching pairs (multiple transitions between the same states are common for OR-semantics).
- `update-animator-state --name X [--layer N] [--rename NEW] [--motion CLIP] [--speed N] [--mirror T] [--cycle-offset N] [--write-defaults T]` — partial update, only listed fields change; reports `changedFields[]`.
- `update-animator-transition --from --to [--index N] [--has-exit-time T] [--exit-time N] [--duration N] [--offset N] [--can-self T] [--interruption-source SRC] [--conditions JSON]` — same partial-update model; conditions wholesale-replace when given.

**Layer management — multi-layer controllers (upper/lower body, additive overlays)**:
- `add-animator-layer --name X [--weight N] [--blending Override|Additive] [--mask AVATAR_MASK_PATH] [--ik-pass T]`
- `remove-animator-layer --layer N` — refuses on layer 0 (every controller needs a base layer).
- `set-animator-layer --layer N [--name X] [--weight N] [--blending B] [--mask P] [--ik-pass T] [--synced-layer N] [--sync-timing T]`

**Blend trees — the most-requested gap**:
- `add-animator-blend-tree --name STATE --type 1d|2d-simple|2d-freeform-directional|2d-freeform-cartesian|direct [--blend-parameter P] [--blend-parameter-y P] [--children JSON]` — creates a state whose Motion is a BlendTree, sub-asset of the controller. Children declared in one shot via JSON: 1D uses `threshold`, 2D uses `position [x,y]`, Direct uses `directBlendParameter`.

**Avatar masks — restrict layers to specific bones / humanoid parts**:
- `create-avatar-mask --name X [--path P] [--humanoid JSON] [--transforms JSON]` — humanoid JSON: `{"Body":true,"Head":true,"LeftLeg":false}` (Root, Body, Head, LeftLeg, RightLeg, LeftArm, RightArm, LeftFingers, RightFingers, LeftFootIK, RightFootIK, LeftHandIK, RightHandIK).
- `set-avatar-mask --asset PATH [--humanoid JSON] [--transforms JSON]` — humanoid is partial-update, transforms is total-replace.
- `inspect-avatar-mask --asset PATH` — full humanoid + transforms readout.

**Override controllers — variant characters reusing a base graph**:
- `create-animator-override-controller --name X --base BASE_CONTROLLER [--path P]`
- `set-animator-override-clip --asset OVR (--base-clip ORIG --override-clip NEW | --overrides JSON)` — single or batch.
- `inspect-animator-override-controller --asset OVR` — base + per-clip overrides with override-vs-passthrough state.

**Inspect enhancement**: `inspect-animator-controller` now surfaces every layer's `defaultWeight`, `blending`, `ikPass`, `syncedLayerIndex`, `avatarMaskPath`. States with a BlendTree motion include `motionType:"BlendTree"` + nested `blendTree` object (type, blendParameter, blendParameterY, childCount, full children list with motion paths, thresholds/positions, timeScale, mirror, cycleOffset).

End-to-end verified: 3 parameters → 3 states → transitions → remove parameter → rename state → update transition → add layer → add 1D blend tree → create avatar mask → assign mask to layer → create override controller → inspect → all consistent.

### Fixed — UX papercuts (4 bugs across daemon/bridge/ugui)
- **Button label silently dropped** in `create-ui-tree` — `{type:"Button", label:"Cancel"}` rendered as the literal text "Button". Asymmetry between widgets: `Button`'s tree builder only forwarded `text` (not `label`) to its widget op, while `Toggle` / `Slider` already used `label`. Fixed both `BuildButton` (UITreeOps.cs) and `CreateButton` (UIWidgetOps.cs) to accept either, preferring `label`. The widget set is now consistent.
- **`set-rect-transform --size '[300,60]'` rejected** by daemon schema validator with "must be string, got array". The C# side already supported all three forms (string `WxH`, array `[w,h]`, dict `{w,h}`); only the schema entry constrained it to `string`. Loosened to `any` for `size`, `pivot`, `offset`, `offsetMin`, `offsetMax`. CLI now also pre-parses bracketed strings as JSON before submitting, so the array form survives shell quoting.
- **Git-Bash leading-slash path translation now auto-corrected** instead of merely warned. `--parent /Foo` on Git-Bash gets rewritten by MSYS to `C:/Program Files/Git/Foo` before reaching the CLI; previously the CLI warned but still passed the broken path to Unity, producing a mysterious "not found". Now the CLI detects the translated form, strips the prefix back to `/Foo`, and prints a notice with the recovery action.
- **Scene-object "not found" errors include near-match suggestions.** Walks all loaded scenes' transforms scoring leaf names by (1) case-insensitive equal, (2) bidirectional substring contains, (3) bounded Levenshtein distance ≤ 2. Returns up to 5 candidate scene paths. `windoww` → "Did you mean: /MainMenu/Window?". `Toog` → "Did you mean: /MainMenu/Window/Tog?". Implementation in `SuggestNearMatches` + `LevenshteinAtMost` in PropertyOps.cs (used by every command that does scene-path resolution: rename, delete, set-property, add-component, etc.).

### Changed — Default screenshot folder moved to project root
- Screenshots now save to `DreamerScreenshots/` at project root instead of `Library/DreamerScreenshots/`. Library/ is hidden in VS Code Explorer (gitignored, often in `files.exclude`), making screenshots inconvenient to browse. The new folder is auto-created on first write with a self-ignoring `.gitignore` (`*` + `!.gitignore`) so PNGs stay out of source control while the folder remains visible. Existing `--save-to` overrides are unaffected.

### Changed — sharper screenshots, on-demand resolution presets
- **`screenshot-scene` default resolution is 1280×720** (HD). Earlier defaults of 1920×1080 / 2560×1440 produced larger files than necessary for typical layout reviews; HD keeps file sizes ~60 KB while remaining legible.
- **`--preset layout|normal|text`** for one-shot resolution selection without remembering pixel counts:
  - `layout` → 800×450 (quick composition check, smallest file)
  - `normal` → 1280×720 (same as default — explicit name)
  - `text` → 2560×1440 (text readability, dense detail)
  - Explicit `--width` / `--height` override the preset's value for that dimension; mix freely.
- **`--filter-mode point|bilinear|trilinear`** flag on `screenshot-scene`. **Default is now `point`** — sharper than Unity's authored filter modes (almost always Bilinear) and the right call for agent inspection. Every UI source texture (`Image`, `RawImage`, `SpriteRenderer`) has its `filterMode` temporarily overridden for the duration of the render, then restored. Pass `bilinear` / `trilinear` to override (rarely needed). Render targets also inherit this filter and MSAA is forced off (`antiAliasing=1`) so renders are pixel-accurate rather than supersampled.
- Result reports `filterMode` (the resolved mode) and `textureFiltersSwapped` (count of distinct source textures whose filter was overridden, deduped by atlas).

### Added — `screenshot-scene` + TextMeshPro support
- **`./bin/dreamer screenshot-scene [--camera NAME] [--width 1920] [--height 1080] [--background-color HEX] [--transparent] [--save-to PATH]`** — render any Camera in the active scene to a PNG. Defaults to `Camera.main`, falling back to the first Camera in the scene. Captures 3D, 2D sprites, particles, post-processing, and UI canvases.
- **ScreenSpaceOverlay canvases handled automatically** — they bypass cameras (drawing directly to the back buffer in a final compositing pass), so off-screen `cam.Render()` doesn't see them. `screenshot-scene` temporarily flips every active overlay canvas to `ScreenSpaceCamera` bound to the render camera, runs the layout pass, captures, then restores the original `renderMode` / `worldCamera` / `planeDistance`. Result reports `flippedOverlayCanvases` count. Verified against the DreamerUIDemos scene with 16 overlay canvases — all rendered correctly into one screenshot.
- **TextMeshPro rendering in `screenshot-prefab`** — `TextMeshProUGUI` and `TextMeshPro` text now renders. TMP has its own mesh-build pipeline that doesn't tick from `Canvas.ForceUpdateCanvases`; resolved via reflection on `TMPro.TMP_Text.ForceMeshUpdate()` in `SetupCanvasForPreview` (zero hard dependency on the TMP package — if not installed, the call is skipped silently). Verified with a hand-built prefab containing both `UnityEngine.UI.Text` and `TextMeshProUGUI` — both rendered.

### Added — `screenshot-prefab` (visual feedback for agents)
- **`./bin/dreamer screenshot-prefab --asset Assets/X.prefab [--width 512] [--height 512] [--angle iso|front|back|side|right|left|top|bottom] [--background-color "#RRGGBB[AA]"|JSON-rgba] [--transparent] [--save-to PATH]`** — renders a prefab to a PNG using Unity's `PreviewRenderUtility`. Camera auto-frames the prefab's combined mesh bounds (computed from `MeshFilter.sharedMesh.bounds` / `SkinnedMeshRenderer.localBounds` / `Sprite.bounds` and transformed to world-space, NOT from `Renderer.bounds` — the latter is uninitialized for objects in a PreviewScene that haven't rendered yet). Two-light rim setup, configurable background.
- **Custom `--background-color`** accepts hex (`#1a3a8a`, `#1a3a8a80`) or JSON RGB(A) array of 0..1 floats (`[1.0, 0.95, 0.7]`). Default neutral gray.
- **`--transparent` flag** — outputs PNG with full alpha channel (color type 6 / RGBA). Skips PreviewRenderUtility's `BeginStaticPreview`/`EndStaticPreview` (which uses an RGB-only internal RenderTexture and silently drops alpha) in favor of a custom ARGB32 RT bound to the preview camera, then `ReadPixels` into an RGBA32 Texture2D. PNGs are now always RGBA regardless of background opacity, so transparency is ready when you need it.
- Output goes to `Library/DreamerScreenshots/<stem>-<guid8>-<ticks>.png` by default (Library/ is gitignored). Override with `--save-to`.
- Result includes `path`, `boundsCenter`, `boundsSize`, `byteCount`. Open the PNG with the Read tool — Claude Code is multimodal, Read returns the image inline so the agent can see what it built.
- **UI/Canvas prefabs render** — auto-detected for three kinds: (1) prefab has a `Canvas` at root, (2) prefab has a `Canvas` descendant, (3) prefab is a fragment with uGUI components but no Canvas (list items, row entries, slot prefabs, etc). Result includes `mode: "ui"`, camera switches to orthographic, default angle becomes `front`. PreviewRenderUtility's preview scene doesn't tick the Canvas mesh-build pipeline, so UI mode parks the prefab off-screen in the active scene, runs `LayoutRebuilder.ForceRebuildLayoutImmediate` on every RectTransform, dirties every Graphic, then renders via a temporary camera.
- **Canvas-less fragments are now wrapped in a temporary WorldSpace Canvas** automatically. Verified against a real fragment (Button + LayoutElement + child Text): all rendered cleanly. Verified against a complex hand-built UI (TitleBar + Slider + Dropdown + Toggle + Buttons): all widgets render with proper layout.
- **`--size [w,h]` flag** to override the prefab's RectTransform `sizeDelta`. Layout-group-driven prefabs come back at zero or near-zero size when standalone; `--size` lets you force a sensible footprint. When unset: `LayoutElement.preferredWidth/Height` hints win, falling back to 400×100.
- Known limitations:
  - **TextMeshProUGUI text often invisible** — TMP has its own mesh-build pipeline that doesn't tick from `Canvas.ForceUpdateCanvases`. Standard `UnityEngine.UI.Text` works.
  - Logic-only prefabs (no MeshFilter/SkinnedMeshRenderer/SpriteRenderer/Canvas/RectTransform) come back as an empty gray frame; the `boundsSize: [1,1,1]` fallback is the tell.
  - Particles, trails, lines, lights, and post-processing don't contribute to bounds — camera frames static-mesh extent only.

### Fixed — `create-script --path` accepting a `.cs` file path
If `--path` ended in `.cs` (e.g. `Assets/Scripts/Foo/Bar.cs`), Dreamer treated the whole string as a folder, `mkdir`'d `Bar.cs/`, and wrote `Bar.cs/Bar.cs` inside it. Now: a `.cs`-suffixed `--path` is split into parent folder + class name. If `--name` is also given and disagrees with the filename, the command fails fast with a clear message instead of silently nesting.

### Added — PlayerSettings + Build Settings authoring
PlayerSettings fields that go through the static `UnityEditor.PlayerSettings` API (icons, per-platform identifiers, cursor) don't round-trip through the generic SerializedObject editor. Added wrappers:

- **`inspect-player-settings [--target standalone|android|ios|webgl|...]`** — common fields via static API: company/product/version, screen, color space, scripting backend, API compatibility, default cursor + hotspot, default icons, per-platform icons. Default target is `standalone`.
- **`set-app-id --target NAME --id com.foo.bar`** — per-platform application/bundle identifier (`PlayerSettings.SetApplicationIdentifier(NamedBuildTarget, string)`). Targets: standalone, android, ios, webgl, tvos, windowsstore, ps4, ps5, xboxone, switch.
- **`set-default-icon --texture Assets/path.png`** — Default Icon slot (`PlayerSettings.SetIcons(NamedBuildTarget.Unknown, [tex], IconKind.Application)`). Unity scales to all platforms.
- **`set-app-icons --target NAME --textures '[...]'`** — per-platform icon array. Result includes `expectedCount` so you can verify against Unity's required slot count for that target.
- **`set-cursor-icon --texture Assets/path.png [--hotspot [x,y]]`** — Default Cursor + click-point hotspot (`PlayerSettings.defaultCursor` / `cursorHotspot`).

EditorBuildSettings.scenes (the build-scenes list) similarly needs its own command surface — it's a `EditorBuildSettingsScene[]` setter, not a SerializedObject array:
- **`inspect-build-scenes`** — list `{index, path, enabled, guid}` for each scene in the list.
- **`set-build-scenes --scenes JSON`** — replace the whole list. Items are either string paths (enabled by default) or `{path, enabled}`. All scenes must exist on disk.
- **`add-build-scene --scene PATH [--enabled false]`** — append; updates the enabled flag in place if already present.
- **`remove-build-scene --scene PATH`** — remove by path.

For other PlayerSettings fields not yet wrapped (companyName, productName, bundleVersion, defaultScreenWidth, etc.), the existing generic command works: `set-project-setting --file ProjectSettings --property companyName --value '"AnttiCo"'` — the SerializedObject reaches them.

### Added — Project Settings authoring (full coverage)
ProjectSettings/*.asset files live outside Assets/, so the existing `set-property`/`inspect-asset` commands (which use `LoadAssetAtPath`) couldn't reach them. Two layers of new commands address this:

**Phase 1 — first-class wrappers for the common cases:**
- **`inspect-project-settings [--file NAME]`** — overview: 32 layers (with name/builtin flag), tags, sorting layers, 3D + 2D physics summary (gravity + disabled-collision pairs), and a list of every `.asset` in `ProjectSettings/`. With `--file X`: per-field listing for that one file.
- **`set-layer-name --index N --name X [--force]`**, **`clear-layer --index N [--force]`** — name a physics/rendering layer; builtin slots (0-7) require `--force`.
- **`add-tag --name X`**, **`remove-tag --name X`** — TagManager tags (uses `InternalEditorUtility.AddTag`/`RemoveTag`).
- **`add-sorting-layer --name X`**, **`remove-sorting-layer --name X`** — 2D sorting layers (Default is protected).
- **`set-layer-collision --layer-a A --layer-b B [--collide true|false] [--2d]`** — physics layer collision matrix (3D + 2D). Names or numeric indices accepted; matrix is symmetric.
- **`set-physics-gravity --value [x,y,z] [--2d]`** — global gravity. 3D = `Physics.gravity`, 2D = `Physics2D.gravity` (requires `--2d`).

**Phase 2 — generic SerializedObject editor for the long tail:**
- **`set-project-setting --file NAME --property PATH --value JSON`** — edit any field on any `ProjectSettings/*.asset` (PlayerSettings build target overrides, GraphicsSettings, TimeManager, AudioManager, QualitySettings, EditorSettings, …). Same value semantics as `set-property` (arrays, sparse `{_size, N: val}`, asset/scene refs, struct objects). Bracket shorthand `field[N]` is rewritten to `field.Array.data[N]`.
- **`inspect-project-setting --file NAME [--property PATH] [--depth N]`** — inspect a single file's full field listing or drill into a sub-tree.

Discovery flow: `inspect-project-settings` lists files → `inspect-project-setting --file X` lists fields on one → `set-project-setting --file X --property m_Y --value V` edits. No gate; project settings are normal authoring operations.

### Added — `set-play-mode` command + per-machine policy gate
- **`./bin/dreamer set-play-mode --state enter|exit|toggle|pause|unpause|toggle-pause`** — first-class play-mode control via `EditorApplication.EnterPlaymode()` / `ExitPlaymode()` / `isPaused`. Replaces the `execute-menu-item Edit/Play` workaround, which silently failed because Unity's `ExecuteMenuItem` returns false for menu items with validation handlers (Play and Pause among them).
- `execute-menu-item Edit/Play` and `execute-menu-item Edit/Pause` are now auto-routed to the new command on the bridge side, so existing agent code that targeted the menu paths keeps working.
- **Per-machine policy gate** — on first bridge start after this update, the developer is asked once via a Unity dialog whether agents may toggle play mode. Default ON. The choice is stored in EditorPrefs (`Dreamer.AllowPlayModeToggle`) and can be flipped at any time in `Tools > Dreamer` under "Agent Policy". When OFF, all agent attempts (including auto-routed Edit/Play) return a clear "disabled by the project owner" error so agents surface the issue rather than retrying.

### Added — AnimatorController authoring (Animation add-on)
- **`create-animator-controller --name X [--path FOLDER]`** — creates a new `.controller` asset with one default layer.
- **`add-animator-parameter --asset <.controller> --name X --type bool|int|float|trigger [--default V]`** — defines a parameter referenced by transition conditions. Names must be unique.
- **`add-animator-state --asset <.controller> --name X [--motion <.anim>] [--speed N] [--layer N]`** — adds a state with an optional `Motion` clip binding. First state on an empty layer auto-becomes default.
- **`add-animator-transition --asset <.controller> --from STATE --to STATE [--conditions JSON] [--has-exit-time true] [--exit-time N] [--duration N]`** — wires a transition. `--from AnyState` for AnyState transitions, `--to Exit` for exit transitions. Conditions: `{parameter, mode: If|IfNot|Greater|Less|Equals|NotEqual, threshold?}`. Multiple conditions = AND.
- **`set-animator-default-state --asset <.controller> --state X [--layer N]`** — overrides the layer's default state.
- **`inspect-animator-controller --asset <.controller>`** — full controller inspection: parameters, layers, states (with motion paths + speeds), transitions (with conditions).
- v1 scope is state-machine root only. Sub-state machines, blend trees, and per-layer masks are out of scope (author them in the Unity Animator window if needed). `Entry` is not supported as a transition source — use `set-animator-default-state` instead, which Unity treats as the implicit entry connection.

### Added — Sprite curves + Animation events (Animation add-on)
- **`set-sprite-curve --asset <.anim> [--target SUB] [--component TYPENAME] [--property NAME] --keys JSON`** — write/replace an ObjectReferenceCurve for sprite-swap animation. Defaults to `SpriteRenderer.m_Sprite`. Each key: `{ "time": N, "sprite": "path.png" }` or `{ "time": N, "sprite": {"assetRef": "path.png", "subAsset": "Walk_0"} }` for multi-sprite atlas slices.
- **`delete-sprite-curve --asset <.anim> [--target SUB] [--component TYPENAME] [--property NAME]`** — remove a sprite-swap curve.
- **`set-animation-events --asset <.anim> --events JSON`** — replace ALL events on a clip. Each: `{ time, functionName, stringParameter?, floatParameter?, intParameter?, objectReferenceParameter? }`. Pass `[]` to clear.
- `inspect-animation-clip` now also returns `events[]` and per-key sprite info on object-reference bindings.

### Added — Animation add-on (`com.dreamer.agent-bridge.animation`)
- New optional package alongside `com.dreamer.agent-bridge.ugui`. Five new commands for AnimationClip authoring (AnimatorController state-machine commands forthcoming).
- **`create-animation-clip --name X [--path FOLDER] [--frame-rate N] [--loop true|false]`** — creates a new `.anim` asset with the given frameRate (default 30) and loop setting.
- **`set-animation-curve --asset <.anim> [--target SUB] --component <FQN> --property <m_Field.x> --keys '[{...}]'`** — write or replace one float-curve binding. `--target` is relative to the animated GO root (empty = root). Each key: `{ t, v, interp?, inTangent?, outTangent?, inWeight?, outWeight? }`. Supported `interp` modes: `linear`, `constant`, `auto`, `clamped`, `free` (free = use explicit tangent values).
- **`inspect-animation-clip --asset <.anim>`** — list all curve bindings with per-curve summary (keyCount, time/value range). Object-reference bindings are listed but not editable in v1.
- **`sample-animation-curve --asset <.anim> [--target SUB] --component <FQN> --property <m_Field.x> [--samples 30] [--t-start N] [--t-end N]`** — evaluate one curve at N evenly-spaced times and return `[{t, v}, ...]`. **The agent's primary tool for verifying curves numerically** — read back after every set-animation-curve to catch tangent surprises and overshoot.
- **`delete-animation-curve --asset <.anim> [--target SUB] --component <FQN> --property <m_Field.x>`** — remove one binding by triple.
- Add-on plugin discovery: same reflection-based pattern as the ugui add-on. If the package isn't installed, dispatcher returns "Unknown command kind" and the schema docs hint at the install command.

### Added — `set-particle-property` command
- New first-class command: `./bin/dreamer set-particle-property (--scene-object PATH | --asset PATH [--child-path SUB]) --property MODULE.FIELD --value JSON`. Reaches ParticleSystem module fields (`main.startLifetime`, `emission.rateOverTime`, `shape.angle`, `noise.strength`, etc.) that the generic `set-property` couldn't touch — modules are exposed via wrapper-struct property accessors, not direct serialized fields, and the underlying serialized names also don't match the API (`main` → `InitialModule`, `limitVelocityOverLifetime` → `ClampVelocityModule`, `textureSheetAnimation` → `UVModule`, …). The handler does the API-name → serialized-name rewrite for the 23 known modules.
- MinMaxCurve scalar shorthand: a bare number (`--value 5`) auto-sets `scalar` + `minScalar` + `minMaxState=Constant`. `{"min":N,"max":M}` sets TwoConstants mode. For curve-mode (animated over particle lifetime), drill into sub-fields explicitly: `main.startLifetime.scalar`, `.minMaxState`, `.maxCurve`.

### Added — `./bin/dreamer update` now lists what changed
- `./bin/dreamer update` diffs `CHANGELOG.md` between the previous and new install and emits `changelog.newEntries[]` in the result JSON. The dreamer skill instructs Claude to read those entries to the user after a successful update — no more "the update worked" without knowing what changed.
- `CHANGELOG.md` is now copied as part of `update`, so installs stay in sync with upstream changelogs.
- `update` now copies the entire `.claude/skills/dreamer/` directory (was: only `SKILL.md`), so companion files like `tasks.md`, `property-values.md`, `materials-shaders.md` also stay current.

### Added — inspect overhaul + read-property (2026-04-25, `2da53da`)
- **`inspect-many --paths a,b,c`** — bulk-inspect N assets in one round-trip. Returns `{count, succeeded, failed, items[]}` in input order; per-item failures become `{path, error}` instead of aborting the batch.
- **`read-property`** — inverse of `set-property`. Same target args (`--asset` / `--scene-object` / `--child-path` / `--component`), returns the property value as JSON. Vectors as `{x,y,z[,w]}`, colors as `{r,g,b,a}`, ObjectReference as `{name, type, assetPath, instanceId}`. No more YAML parsing for field reads.
- **`--include-transforms`** on `inspect` / `inspect-hierarchy` / `inspect-many` — every node gets `transform: {localPosition, localEulerAngles, localScale}`.
- **`--include-fields`** on the same commands — every component gets a `fields[]` array with serialized values (primitives, vectors, colors, refs). Heavier payload — opt-in.
- **`--depth N`** on inspect commands — cap recursion. Default `-1` = unlimited; `0` = root only.
- **`inspect-hierarchy --asset PREFAB.prefab`** — dump a prefab's full hierarchy via AssetDatabase. Was scene-only — agents had to fall back to YAML parsing for prefab structure.
- **`execute-method --args '<JSON-array>'`** — pass arguments to the static method. Type-coerced against the resolved overload (`long → int`, `double → float`, enum names, primitive arrays). Escape hatch is now usable for tasks that need scratch logic.
- **`help` accepts both kinds and CLI verbs** — `./bin/dreamer help inspect-many` now resolves (was: only `help inspect_assets` worked).

### Changed — inspect shape (2026-04-25, `2da53da`)
- `inspect` recurses ALL children by default. Was 1 level deep — deeper nodes only showed `childCount`.
- `inspect_asset` and `inspect_hierarchy` now produce IDENTICAL node shape — `{type, fullType, enabled}` per component, same across root and children. Previously root used `{type, name}` and children used bare strings.
- Every node exposes `instanceId, active, tag, layer, isStatic, childCount` (asset side previously only had components + 1-level children).

### Fixed (2026-04-25, `2da53da`)
- Schema validator recognizes the `integer` type (was: every schema field declared `integer` errored at validation time).
- `save-assets` now also saves dirty open scenes via `EditorSceneManager.SaveOpenScenes`. Previously scene-object mutations stayed in-memory after a "successful" save-assets call — `git diff` showed nothing.

### Added — scene/prefab editing (2026-04-19 → 2026-04-21)
- **`reparent` command** (`677c883`) — works in both scenes (`--scene-object`) and prefabs (`--asset --child-path`). Flags: `--new-parent`, `--keep-world-space`, `--sibling-index`. Cycle guard refuses self-/descendant-parenting with a chain in the error.
- **`set-property` rejects `m_Name` with a directive** (`6e90f88`) — points the caller at `rename` instead of returning a cryptic "Property not found on Component".

### Added — documentation surface (2026-04-19 → 2026-04-25)
- **All 38 command kinds have structured schemas** (`7c9dc3a`) — `./bin/dreamer help <kind>` returns args, examples, pitfalls, result shape.
- **`help conventions`** — cross-cutting rules (target forms `--asset` / `--scene-object` / `--child-path`, value formats for refs / sub-assets / sparse arrays, play-mode gating, multi-agent rules, forbidden patterns) factored out so per-kind schemas don't repeat them.
- **Per-schema `pitfalls[]` arrays** (`111390b`) — anti-patterns and "wrong → right" pairs surface inline next to the args.
- **`unity-scene-builder` subagent** (`677c883`) — translates scene descriptions to a sequence of Dreamer CLI calls.
- **`tasks.md` task→command index** (`111390b`) — flat lookup table for common workflows in the dreamer skill.

### Added — uGUI add-on (optional, shipped as `com.dreamer.agent-bridge.ugui`)
- **Separate Unity package** with its own asmdef, auto-registered into core
  via a reflection-based plugin hook in `CommandDispatcher`. Core Dreamer
  compiles and runs identically whether or not the add-on is installed.
- **Three public commands** — the entire UI-building surface:
  - `create-ui-tree --json JSON_OR_@file` — declarative tree builder.
    Modes: `create` / `append` / `replace-children` / `replace-self`.
    Starts at any level of the hierarchy, not just Canvas roots — agents
    can rebuild one panel without touching the surrounding UI. Node types:
    Panel, Image, Text, Button, VStack, HStack, Grid, ScrollList, Slider,
    Toggle, InputField, Spacer, Raw (escape hatch for custom
    MonoBehaviours).
  - `inspect-ui-tree --target PATH [--depth N]` — round-trip inspector.
    Dumps an existing UI subtree to the same schema the builder consumes.
    Recognized widgets get their type; unrecognized GOs become `Raw` with
    `components[]` preserved. Enables the read-edit-rebuild workflow.
  - `set-rect-transform (--scene-object PATH | --asset PATH) [--anchor
    PRESET] [--size WxH] [--pivot X,Y]` — one-call anchor/size/pivot
    configuration with 16 named presets (`center`, `top-stretch`, `fill`,
    etc.) instead of six brittle `set-property` calls.
- **`./bin/dreamer addon` subcommand** — `list` / `install <name>` /
  `remove <name>`. Installed add-ons are recorded in
  `daemon/.dreamer-source.json`'s `addons[]` field; `./bin/dreamer update`
  honors that list and refreshes them alongside core.
- **Separate skill file** at `.claude/skills/dreamer-ugui/SKILL.md` with a
  companion `schema.md` reference. Auto-loads only when the agent
  encounters UI-flavored task language (Canvas, Button, HUD, menu, etc.),
  so core Dreamer sessions pay no context cost for UI docs.
- **Design principle**: the UI scaffold Claude builds is intentionally
  legible-not-perfect — the user refines visually in Unity's Scene/Game
  view afterward. Claude's job is correct hierarchy + anchoring; Unity's
  job is pixel polish.

### Added — core
- **Material + shader commands** — closes a gap where materials couldn't
  be created or meaningfully edited via Dreamer (the generic set-property
  path didn't reach Unity's `MaterialProperty` API). Six new commands:
  - `create-material --name X [--path FOLDER] [--shader "Shader/Name"]` —
    creates a new `.mat` asset, falls back to Standard/URP-Lit/HDRP-Lit
    when `--shader` omitted (warning in result JSON).
  - `inspect-material --asset X.mat` — returns shader + full property
    list (name, display name, type, current value, range for Range props)
    + active keywords + render queue.
  - `set-material-property --asset X.mat --property _BaseColor --value
    '{"r":1,...}'` — routes by shader-declared property type to the right
    MaterialProperty setter. Color / Vector / Float / Int / Range / Texture
    values supported. Keyword form: `--keyword _EMISSION --enable true`.
  - `set-material-shader --asset X.mat --shader "Name"` — reassigns shader
    (Unity preserves compatible property values).
  - `shader-status [--asset X.shader]` — wraps `ShaderUtil.GetShaderMessages`.
    No-arg form scans every user shader under Assets/. Returns
    `status: ok|warnings|errors` plus per-message severity/text/file/line.
  - `inspect-shader (--asset X.shader | --shader "Name")` — declared
    property list + keywords + render queue + maximum LOD + any existing
    compile messages.
  Writing shader source is the same as writing .cs: direct file write +
  `refresh-assets`. There is no `create-shader` command — templates vary
  too much per render pipeline to be useful from Dreamer.
- **Play Mode gate for scene-edit commands.** Scene mutations made during
  Play Mode silently revert on exit (Unity's design — only EditMode edits
  persist). Dreamer now holds such commands in `waiting` with reason
  *"Play Mode active — scene edits would be lost on exit. Stop Play Mode
  in Unity (or submit with --allow-playmode to override)."* Gated kinds:
  `create_gameobject`, `instantiate_prefab`, `create_hierarchy` (scene
  mode, no `savePath`), and any `add_component` / `remove_component` /
  `set_property` / `delete_gameobject` / `rename_gameobject` /
  `duplicate` / `remove_missing_scripts` targeting a scene object. Asset
  targets, script writes, and read-only commands are not gated. Override
  flag: `--allow-playmode` on the CLI (serialized as
  `options.allowPlayMode` in the API).
- **`./bin/dreamer activity`** — newest-first view of recent commands across
  the queue, with per-entry label / kind / state / age / duration. Built for
  multi-agent visibility: when several Claude sessions drive the same
  project, each agent can call `activity --since 2m` before drawing
  conclusions about compile errors or scene state. Flags: `--limit N`,
  `--since 90s|5m|1h`, `--state X`. Exposed at `GET /api/activity`.
- **`--label TEXT` flag promoted as a first-class tool** in CLI help +
  SKILL.md. The flag already existed (as `humanLabel`); it's now documented
  as the canonical way to tag commands in parallel-agent scenarios, e.g.
  `--label "sessionA:player-setup"`. Labels appear in `status`, `queue`,
  and `activity` output.
- **SKILL.md "Parallel agent sessions" section** — tool-focused guidance,
  no prescriptive coordination protocol. Core rule: check
  `activity --since 2m` before blaming yourself for compile errors in
  multi-agent workflows.
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
- **`set-property` on sprite sub-asset references** (SpriteRenderer.m_Sprite
  and similar) no longer silently no-ops. Previously, `assetRef` pointing at
  a Texture2D resolved to the main Texture asset and Unity silently dropped
  the cross-type assignment, leaving `m_Sprite: {fileID: 0}`. The object-ref
  resolver now:
  - Accepts an explicit `"subAsset": "name"` modifier to pick a named
    sub-asset (required for Multiple-mode sprite atlases).
  - When the field type can't be resolved via reflection (common for Unity
    built-in component fields), probes the main asset + each sub-asset
    against the SerializedProperty and auto-picks the one Unity accepts.
  - When multiple sub-assets match, returns an error listing candidates
    so the caller can disambiguate with `subAsset` — no more silent wrong
    assignment.
- **Prefab-editing commands no longer overwrite a successful outcome with
  a UnloadPrefabContents cleanup error.** `PrefabUtility.SaveAsPrefabAsset`
  sometimes disposes the internal scene backing the prefabRoot, so the
  subsequent `PrefabUtility.UnloadPrefabContents` throws "Specified object
  is not part of Prefab contents" — despite the save having already
  landed. Previously this threw the command into `failed` state even
  though the prefab asset was correct on disk. Now every Op that loads
  prefab contents uses `PrefabOps.SafeUnloadPrefabContents`, which
  swallows the cleanup error (the mutation is already persisted) and logs
  a diagnostic. Fixes the reported `add-component --asset` "error but
  component was actually applied" pattern.
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
