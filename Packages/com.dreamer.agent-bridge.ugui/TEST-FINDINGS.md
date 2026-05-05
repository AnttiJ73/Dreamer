# UGUI add-on — end-to-end test findings (2026-04-20)

Built a multi-panel game-style UI in `Assets/Scenes/DreamerUITest.unity` (The Dreamer Unity project) using only `create-ui-tree`, `set-rect-transform`, `inspect-ui-tree` plus standard `add-component` / `set-property` for the sub-canvas retrofit.

What was built (all under one root Canvas `/GameUI`):
- **HUD** — top-stretch bar: portrait frame, three stacked sliders (HP/MP/XP), gold text, minimap placeholder
- **Inventory** — right-side stretched panel: title row with close button, weight label, 5×4 Grid of slots, three action buttons
- **QuestLog** — left-side stretched panel: title row, ScrollList with five quest entry panels (each: title, description, two action buttons)
- **Settings** — centered modal: section headers, three slider rows with labels + value text, three Toggles, Apply/Cancel
- **Shop** — centered two-column: header row with gold + close, scrollable item list (7 items, each with icon/name/desc/price), detail pane with preview/name/stats/description/price/Buy
- **Notification** — top-anchored floater: icon, title + body text, OK button

Total: 6 panels, ~90 widgets. Built in 6 `create-ui-tree` calls + 4 `add-component` + 2 `set-property` (sub-canvas wiring) — about 30 seconds end-to-end.

---

## What works well

1. **Declarative tree is the right primitive.** Each panel was one JSON spec and one CLI call. No path arithmetic, no per-widget RectTransform math, no EventSystem boilerplate.
2. **`mode: append` + a target path made composition trivial.** Build the root Canvas once, then drop each subsequent panel under `/GameUI` without re-specifying the canvas envelope.
3. **EventSystem auto-creation** — never had to think about it. Inspect confirmed one was added next to the canvas.
4. **Anchor presets** — 16 named presets covered every position need. Stretching with `offsetMin`/`offsetMax` (Inventory, QuestLog) worked first try.
5. **Widget primitives all worked.** Image, Text, Button, Slider, Toggle, ScrollList, Grid, VStack, HStack, Spacer, Panel — all behaved as documented.
6. **Slider + Toggle round-trip cleanly** in `inspect-ui-tree` (min/max/value/whole, isOn/label).
7. **Color formats** — `"#RRGGBB"`, `"#RRGGBBAA"`, named all worked. Mixing them within one tree was fine.
8. **Result JSON includes `rootPath`** so the next call knows where the new node landed. Used `/GameUI/HUD`, `/GameUI/Inventory`, etc. directly from prior results.
9. **`@file.json` syntax for `--json`** — essential. The Shop panel's spec was ~9 KB and exceeded what bash could quote on one line. Loading from a file just worked.
10. **Sub-canvas retrofit via `add-component` is fine.** Adding `UnityEngine.Canvas` + `UnityEngine.UI.GraphicRaycaster` to existing panels worked, then `set-property` on `overrideSorting` / `sortingOrder` finished the job.

## What is inconvenient or broken

### High-impact

0. **EventSystem auto-create wired the wrong input module** (FIXED in source 2026-04-20). `EnsureEventSystem` hardcoded `StandaloneInputModule`, which throws `InvalidOperationException: You are trying to read Input using the UnityEngine.Input class, but you have switched active Input handling to Input System package` at runtime in projects using the new Input System. Fix: detect via `ENABLE_INPUT_SYSTEM` define + reflection lookup of `UnityEngine.InputSystem.UI.InputSystemUIInputModule` (no hard package dependency); fall back to `StandaloneInputModule` if package isn't installed. Live test scene patched manually via `remove-component` + `add-component`. Source fix in [Editor/Operations/UIHelpers.cs:496](Editor/Operations/UIHelpers.cs#L496).

1. **No native sub-Canvas in the tree schema.** User explicitly wanted "root canvas with multiple sub-canvases". Schema only accepts `canvas: {...}` at the top level under `mode: create`. Workaround used: build as plain Panels, then 4 follow-up `add-component` calls + 2 `set-property` calls per sub-canvas. **Suggest**: add a `Canvas` container type (or a `subCanvas: {sortOrder, overrideSorting, pixelPerfect}` modifier on Panel) so a 6-panel UI with sub-canvases is still 6 calls, not 6 + 24.

2. **Inspect output is not symmetric with create input — round-trip is lossy.** Specifically:
   - `color` (input field) comes back as `color_raw` (a stringified JSON-in-JSON, e.g. `"{\"r\":0.0627451,\"g\":0.0941...,\"b\":...,\"a\":...}"`). Field name renamed; format unparseable as-is by `create-ui-tree` (it expects a color object/hex/name, not a stringified blob).
   - `Text.color` and `Text.alignment` round-trip lost — input had `"color": "#FFD24A", "alignment": "middle-left"`, inspect returns only `text` + `fontSize`.
   - `Button.bgColor`, `Button.textColor`, `Button.fontSize`, `Button.sprite` round-trip lost — Apply (green) and Cancel (red) bg-colors gone from inspect output.
   - `ScrollList.contentLayout`, `spacing`, `padding` round-trip lost — only `direction` survives.
   - `VStack`/`HStack`/`Grid` layout fields (`spacing`, `padding`, `childAlignment`, `controlChildSize`, `cellSize`, `fitContent`) all round-trip lost.
   - `Panel.sprite` round-trips as `"Resources/unity_builtin_extra"` (built-in sprite path) — opaque, not the value the user supplied.
   
   This breaks the documented workflow of inspect → edit → replace-children. The schema doc explicitly promises round-trip ("It returns the same schema you'd write, so you can edit and feed it back"). It does not.

3. **Layout-managed sizes round-trip wrong.** ScrollList specified with `size: [0, 380]` came back with `sizeDelta: {0, 0}`. Quest entry panels specified `size: [0, 90]` came back as `{0, 10}`. The actual rendered size is correct (Unity's LayoutGroup handles it), but the inspected sizeDelta reflects the raw RectTransform value before LayoutGroup applies preferred sizes. If a user feeds this back, the sizes will be wrong.

### Medium-impact

4. **`/`-prefixed scene paths get mangled by Git Bash** (Windows). `--scene-object /GameUI/Inventory` → `Scene object not found at path: C:/Program Files/Git/GameUI/Inventory.` MSYS converts leading `/` to its install root. Workaround: prefix the command with `MSYS_NO_PATHCONV=1`. **Suggest**: detect and fix in the CLI's argument parser (if a `--scene-object` value starts with the MSYS install path that doesn't exist in the project, strip it). Or document the gotcha prominently.

5. **`create-scene` silently drops unknown flags.** Used `--open` and `--setup empty` — both ignored, no warning. Had to do `open-scene` as a separate call. The CLI accepted the flags without complaint.

6. **`open-scene` rejects `--path` flag** even though `create-scene` accepts it. Inconsistent: positional arg only for `open-scene`, but `create-scene` uses `--name`/`--path`. Made me try the wrong syntax first.

7. **`controlChildSize: false, childForceExpandWidth: false`** is sometimes the only way to keep a child's size as you specified — the default LayoutGroup behavior overwrites sizes silently. Took several panels of trial-and-error to find the right combo. Worth documenting an "explicit sizing" recipe in the skill.

### Low-impact / nits

8. **No `warnings[]` in any of my 6 build results** — schema doc says warnings show up there, and indeed they didn't fire because I stayed within documented types. Good. But there's no easy way to verify "no warnings" without inspecting every build result.

9. **`create-scene` doesn't have a `--help` summary in `dreamer help <kind>`** — got "No schema for 'create-scene'" when I tried. Other kinds work. Schema gap.

10. **LayoutGroup-positioned children have nonzero `anchoredPosition` in inspect output** even though the LayoutGroup will overwrite them on next layout. Cosmetic — round-trip would feed those back, then LayoutGroup would re-position. So functionally OK but visually noisy in inspect JSON.

11. **`text` content of a Text widget collides with the default GameObject name "Text"** — inspect gives several siblings literally named `"Text"`. Not a bug, but harder to navigate by path. Worth setting `name` explicitly when a Text appears in a layout group with other Texts.

---

## Recommended next steps

Priority order:

1. **Fix round-trip fidelity** (issue #2). This is the workflow promise of the add-on. At minimum: emit `color` instead of `color_raw` (and as `"#RRGGBB"` not stringified-JSON); emit Text.color/alignment; emit Button.bgColor/textColor/fontSize/sprite; emit LayoutGroup fields on VStack/HStack/Grid/ScrollList. Until this lands, recommend in the skill that users **rebuild from their original spec, not from inspect output**.
2. **Add native sub-Canvas support** (issue #1). Either a new container type or a Panel modifier. The 4-call retrofit per sub-canvas is the difference between "use the tool for game UI" and "build it in code anyway".
3. **Fix or document the Git Bash path mangling** (issue #4). One-line CLI fix or a prominent note in INSTALL.md.
4. **Validate flags in CLI** (issue #5, #6). Warn or error on unknown flags rather than silently dropping.
5. **Document the "explicit sizing" recipe** (issue #7) — when LayoutGroup will respect your size and when it won't.

Less urgent but worth tracking:

6. Strip layout-managed `anchoredPosition` and `sizeDelta` from inspect output when a LayoutGroup parent will overwrite them (issue #10).
7. Add `dreamer help create-scene` schema (issue #9).

---

## Test artifacts

- Scene: `Assets/Scenes/DreamerUITest.unity`
- Sub-canvases live: `/GameUI/Inventory`, `/GameUI/Shop` (both have Canvas + GraphicRaycaster + overrideSorting)
- Shop spec preserved at `.tmp_ui/shop.json` (delete with the scene)
- Total commands sent: 6 × `create-ui-tree` (one per panel), 4 × `add-component` (sub-canvas retrofit), 2 × `set-property` (overrideSorting/sortingOrder), 3 × `inspect-ui-tree`, 1 × `save-scene`, 1 × `inspect-hierarchy`.
- Zero failed commands. One bash-quoting failure (recovered by switching to `--json @file`). One git-bash path mangling (recovered by `MSYS_NO_PATHCONV=1`).
