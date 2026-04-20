---
name: dreamer-ugui
description: Build and edit Unity Canvas (uGUI) UIs via Dreamer's declarative tree command. Use whenever the task involves creating or modifying uGUI menus, HUDs, panels, buttons, scroll views, or other Canvas-based UI in a Unity project that has the Dreamer UGUI add-on installed. Activated by mentions of Canvas, Button, Panel, HUD, menu, UI layout, RectTransform, or UGUI.
---

# Dreamer — UGUI (Canvas UI) add-on

Optional add-on that layers three commands on top of Dreamer for building and iterating on Unity's Canvas UI system. Installed via `./bin/dreamer addon install ugui`; if the add-on isn't present, the commands return a clear install hint.

This is for **uGUI** (the Canvas-based UI system). UI Toolkit (UXML/USS) is a different system — agents handle UXML files fine via direct write + `refresh-assets`, so there's no Dreamer add-on for it.

## The three commands

| Command | When to use |
|---|---|
| `create-ui-tree` | Build a new UI subtree from a JSON spec. Handles Canvas creation, layout groups, every common widget. Modes: `create`, `append`, `replace-children`, `replace-self`. Start at any level of the hierarchy. **This is the main tool — reach for it first.** |
| `inspect-ui-tree` | Dump an existing UI subtree back to the same JSON schema. Use to read current state before modifying. |
| `set-rect-transform` | Tweak one specific element's anchoring / size / pivot without rebuilding. Use for small adjustments. |

## Design philosophy

The user will refine the UI visually in Unity's Scene/Game view after Claude builds it — Unity's editor is already good at that. Claude's job is to **get the structure right**: correct component hierarchy, reasonable anchoring, layout groups configured properly. Pixel-perfect styling is not the goal. A legible scaffold that compiles and is easy to edit visually is.

## Basic examples

### Build a main menu from scratch

```bash
./bin/dreamer create-ui-tree --wait --json '{
  "mode": "create",
  "canvas": {"name": "MainMenu", "renderMode": "overlay"},
  "tree": {
    "type": "VStack", "name": "Menu",
    "anchor": "center", "size": [400, 400],
    "padding": 20, "spacing": 10, "fitContent": false,
    "children": [
      {"type": "Text", "text": "My Game", "fontSize": 48, "alignment": "center"},
      {"type": "Button", "text": "Play"},
      {"type": "Button", "text": "Options"},
      {"type": "Button", "text": "Quit"}
    ]
  }
}'
```

### Add a HUD to an existing Canvas

```bash
./bin/dreamer create-ui-tree --wait --json '{
  "mode": "append",
  "target": "/MainCanvas",
  "tree": {
    "type": "HStack", "name": "TopBar",
    "anchor": "top-stretch", "size": [0, 60],
    "padding": [10, 10, 10, 10], "spacing": 20,
    "children": [
      {"type": "Text", "text": "Score: 0", "fontSize": 24},
      {"type": "Spacer"},
      {"type": "Text", "text": "HP: 100", "fontSize": 24}
    ]
  }
}'
```

### Iterate on an existing UI

```bash
# Read current state
./bin/dreamer inspect-ui-tree --target /MainCanvas/Menu --wait

# ... edit the JSON that came back ...

# Replace the subtree with the modified version
./bin/dreamer create-ui-tree --wait --json '{
  "mode": "replace-children",
  "target": "/MainCanvas/Menu",
  "tree": { ...new tree... }
}'
```

### Nudge one element's anchoring

```bash
./bin/dreamer set-rect-transform --scene-object /MainCanvas/Menu/PlayButton --anchor center --size 200x60 --wait
```

## Writing a tree — the JSON schema at a glance

Every node has a `type` plus optional `name`, `anchor`, `size`, `pivot`, `offset` for RectTransform, plus type-specific fields, plus `children: [...]` for containers.

**Container types** (take children):
- `Panel` — background image + RectTransform. Fields: `color` (`"#RRGGBB"` or `{"r","g","b","a"}`), `sprite` (asset path)
- `VStack` — vertical LayoutGroup. Fields: `padding` (N or `[l,t,r,b]`), `spacing` (N), `childAlignment`, `fitContent` (bool)
- `HStack` — horizontal LayoutGroup. Same fields as VStack
- `Grid` — grid LayoutGroup. Fields: `cellSize` (`[w,h]`), plus VStack's fields
- `ScrollList` — ScrollRect with Viewport + Content. Fields: `direction` (`"vertical"|"horizontal"|"both"`), `contentLayout` (`"vertical"|"horizontal"|"grid"`), plus VStack's layout fields. Children are placed in Content, not the root.

**Leaf types**:
- `Text` — TMP if available, legacy Text otherwise. Fields: `text`, `fontSize`, `color`, `alignment` (`"center"|"top"|"top-left"|...`)
- `Button` — Image + Button + child Text. Fields: `text`, `fontSize`, `bgColor`, `textColor`, `sprite`. onClick wiring is NOT auto-done — use Unity's inspector or a follow-up `set-property` on the button's `onClick` field.
- `Image` — Image component. Fields: `sprite` (path string or `{"assetRef":...,"subAsset":"name"}`), `color`, `preserveAspect` (bool)
- `Slider` — Fields: `min`, `max`, `value`, `whole` (bool), `direction` (`"left-to-right"` etc.)
- `Toggle` — Fields: `label`, `isOn` (bool)
- `InputField` — Fields: `placeholder`, `text`
- `Spacer` — flexible space for layout groups. Field: `flex` (weight, default 1), optional `size` (minimum)
- `Raw` — escape hatch, bare GameObject + optional `components: ["Namespace.Type"]` array for custom MonoBehaviours

**Anchor presets** (for `anchor` field):
```
fill                              top-left    top    top-right
top-stretch                       left        center right
middle-stretch                    bottom-left bottom bottom-right
bottom-stretch
stretch-left  stretch-center  stretch-right
```

**Sizes** can be `[w,h]`, `"WxH"`, or `{"w":N,"h":N}`.

## Modes for `create-ui-tree`

| Mode | Behavior | Target required? |
|---|---|---|
| `create` | Build a new Canvas (from `canvas` field) + place `tree` inside it | No |
| `append` | Add `tree` as a new child of `target` | Yes |
| `replace-children` | Delete all children of `target`, rebuild from `tree` | Yes |
| `replace-self` | Delete `target`, put `tree` where it was | Yes (must not be scene root) |

The tree can start at any level — target a specific panel, not just the canvas root. Useful when iterating on a sub-section of existing UI.

## Workflow tips

- **Before modifying a complex existing UI, always call `inspect-ui-tree` first.** It returns the same schema you'd write, so you can edit and feed it back.
- **Run `./bin/dreamer compile-status` first** if the tree uses custom types via `Raw → components`. Unknown types are silently skipped otherwise.
- **Check the result's `warnings[]` field** after `create-ui-tree`. Unknown node types, missing custom components, and unsupported props get logged there.
- **onClick wiring is out of scope** for v0.1.x. Build the button, then ask the user to hook up the event in Unity's inspector — it's one click. Or use `set-property` on the button's `onClick.m_PersistentCalls` field if you really need to script it (complex — the inspector is easier).
- **Play Mode gate applies**: `create-ui-tree` and `set-rect-transform` (on scene objects) wait for Play Mode to exit. Asset-targeting `set-rect-transform` (prefab UI) is not gated.

## Full schema reference

See [schema.md](schema.md) in this skill directory for the full schema — every node type, every field, every enum value. Loads on demand when you need the precise spec.

## When the add-on is missing

If `create-ui-tree` returns *"Unknown command kind: create_ui_tree"*, the add-on isn't installed. Tell the user:

> To enable UI building commands, run: `./bin/dreamer addon install ugui`

This fetches the add-on from the Dreamer repo, installs it into Unity, and registers the commands. No restart needed beyond Unity's automatic bridge recompile.
