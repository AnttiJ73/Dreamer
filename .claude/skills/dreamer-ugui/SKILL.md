---
name: dreamer-ugui
description: Build and edit Unity Canvas (uGUI) UIs via Dreamer's declarative tree command. Use whenever the task involves creating or modifying uGUI menus, HUDs, panels, buttons, scroll views, or other Canvas-based UI in a Unity project that has the Dreamer UGUI add-on installed. Activated by mentions of Canvas, Button, Panel, HUD, menu, UI layout, RectTransform, or UGUI.
---

# Dreamer — UGUI (Canvas UI) add-on

Optional add-on. Adds three commands for declarative Canvas UI building. UI Toolkit (UXML) is a different system — not covered here; handle via direct file write + `refresh-assets`.

If you forget the exact verb for any uGUI command, run `./bin/dreamer search "<query>"` (e.g. `search "build canvas"`, `search anchor`) — it covers add-on schemas alongside core commands.

## Commands

| Command | Use for |
|---|---|
| `create-ui-tree` | Build/replace UI from a JSON spec. Modes: `create`, `append`, `replace-children`, `replace-self`. **Default tool.** |
| `inspect-ui-tree` | Read existing UI back as the same JSON schema. Use before modifying. |
| `set-rect-transform` | Single-element anchor/size/pivot tweak. Use for small adjustments. |

## Read these before building anything non-trivial

Both ship with the add-on at `Packages/com.dreamer.agent-bridge.ugui/`:

- **`UI-DESIGN-CONVENTIONS.md`** — naming, structure, sizing, spacing rules. Optimized for legible first-build output that the user can edit visually OR describe back to you.
- **`UNITY-LAYOUT-QUIRKS.md`** — Unity behaviors the schema works around. Read when a layout doesn't render the way the spec says.

`schema.md` (this skill folder) is the full schema reference — every node type, every field, every enum.

## Hard rules

- Always pass `--wait` on `create-ui-tree` and `set-rect-transform`.
- Always check the result's `warnings[]` — schema flags things that compile but render wrong.
- Default to `ScrollList` for any list or growable content.
- Pick `anchored` OR `LayoutGroup` per container, never both.
- Set `size` on every LayoutGroup child. `[0, 0]` or omitted = fill.
- One flex child per axis in a LayoutGroup. Header (fixed) + Content (flex) + Footer (fixed) is the universal pattern.

## Modes

| Mode | Effect | `target` required |
|---|---|---|
| `create` | New Canvas + tree under it | No |
| `append` | Add tree as new child of target | Yes |
| `replace-children` | Clear target's children, build from tree | Yes |
| `replace-self` | Delete target, put tree in its place | Yes (must have parent) |

## Quick build

```bash
./bin/dreamer create-ui-tree --wait --json '{
  "mode": "create",
  "canvas": {"name": "MainMenu", "renderMode": "overlay"},
  "tree": {
    "type": "VStack", "name": "Menu",
    "anchor": "center", "size": [400, 400],
    "padding": 20, "spacing": 10,
    "children": [
      {"type": "Text", "text": "My Game", "fontSize": 32, "size": [0, 48], "alignment": "middle-center"},
      {"type": "Button", "name": "PlayBtn",    "text": "Play",    "size": [0, 48]},
      {"type": "Button", "name": "OptionsBtn", "text": "Options", "size": [0, 48]},
      {"type": "Button", "name": "QuitBtn",    "text": "Quit",    "size": [0, 48]}
    ]
  }
}'
```

## Iterate on existing UI

```bash
# Read current
./bin/dreamer inspect-ui-tree --target /MainCanvas/Menu --wait

# Rebuild that subtree with edited JSON
./bin/dreamer create-ui-tree --wait --json '{
  "mode": "replace-children",
  "target": "/MainCanvas/Menu",
  "tree": { ...edited... }
}'
```

For single-element anchor/size adjustment without rebuild:
```bash
./bin/dreamer set-rect-transform --scene-object /MainCanvas/Menu/PlayBtn --anchor center --size 200x60 --wait
```

## Schema at a glance

Every node: `type` + optional `name`, `anchor`, `size`, `pivot`, `offset` / `margin`, plus type-specific fields, plus `children: [...]` for containers.

**Containers** (take children):

| type | fields | notes |
|---|---|---|
| `Panel` | `color`, `sprite` | Background image + RectTransform |
| `VStack` / `HStack` | `padding`, `spacing`, `childAlignment` | Vertical/Horizontal LayoutGroup |
| `Grid` | `cellSize: [w,h]`, plus VStack fields | Fixed cell grid |
| `ScrollList` | `direction: "vertical"\|"horizontal"\|"both"`, `contentLayout`, `spacing`, `padding`, `mapPanZoom` | Children placed in Content |

**Leaves**:

| type | fields |
|---|---|
| `Text` | `text`, `fontSize`, `color`, `alignment` |
| `Button` | `text`, `fontSize`, `bgColor`, `textColor`, `sprite` (onClick NOT auto-wired) |
| `Image` | `sprite`, `color`, `preserveAspect`, `imageType` (`Simple`/`Sliced`/`Tiled`/`Filled`), `fillAmount`, `fillMethod`, `fillOrigin`, `fillClockwise` |
| `Slider` | `min`, `max`, `value`, `whole`, `direction` |
| `Toggle` | `label`, `isOn` |
| `InputField` | `placeholder`, `text` |
| `Dropdown` | `options: [...]`, `value: int`, `captionFontSize`, `itemFontSize` |
| `Spacer` | `flex` (default 1), `size` (minimum) |
| `Raw` | `components: ["Namespace.Type", ...]` — escape hatch |

**Anchor presets**: `top-left`, `top`, `top-right`, `left`, `center`, `right`, `bottom-left`, `bottom`, `bottom-right`, `top-stretch`, `middle-stretch`, `bottom-stretch`, `stretch-left`, `stretch-center`, `stretch-right`, `fill`.

**Sizes**: `[w, h]`, `"WxH"`, or `{"w": N, "h": N}`.

## Build-time gotchas

- `Raw` with `components`: run `./bin/dreamer compile-status` first if your custom types might not exist. Unknown types are skipped with a warning.
- `mapPanZoom: true` on a ScrollList: attaches MapPanZoom + zeroes scrollSensitivity (so wheel zooms instead of scrolling).
- `imageType: "Filled"` + `fillAmount`: image fill percentage. Use for HP/MP bars, progress indicators (NOT Slider — that's for user-interactive).
- `Button`'s onClick wiring: out of scope. Build the button, ask the user to wire it in Inspector or use `set-property` on `onClick.m_PersistentCalls`.
- Play Mode gate: `create-ui-tree` and scene-targeting `set-rect-transform` wait for Play Mode to exit. Asset-targeting `set-rect-transform` is not gated.

## When the add-on is missing

If `create-ui-tree` returns "Unknown command kind: create_ui_tree", tell the user:

> To enable UI building commands, run: `./bin/dreamer addon install ugui`
