# UGUI tree schema — full reference

Progressive-disclosure companion to SKILL.md. Read this when you need the precise field list for a specific node type, or when the main SKILL.md's summary isn't enough.

## Top-level envelope (create-ui-tree arg)

```jsonc
{
  "mode": "create" | "append" | "replace-children" | "replace-self",
  "target": "/Canvas/Path",     // required for append / replace-*; omit for create
  "canvas": {                    // only used for mode=create
    "name": "string",
    "renderMode": "overlay" | "camera" | "world",
    "referenceResolution": [1920, 1080],
    "sortOrder": 0
  },
  "tree": { ...node spec... }
}
```

## Common fields on every node

| Field | Type | Notes |
|---|---|---|
| `type` | string | Required. See per-type sections below. |
| `name` | string | GameObject name. Defaults to the type name. |
| `anchor` | string | Preset name — see anchor presets below. If omitted, keeps default (center). |
| `size` | `[w,h]` \| `"WxH"` \| `{"w":N,"h":N}` | RectTransform sizeDelta (or stretch margins on stretched axes). |
| `pivot` | `[x,y]` \| `{"x":N,"y":N}` | Override the anchor preset's default pivot. |
| `offset` / `anchoredPosition` | `[x,y]` | Position relative to the anchor. |
| `offsetMin` | `[x,y]` | Fine control for stretched anchors — left/bottom inset. |
| `offsetMax` | `[x,y]` | Fine control — right/top inset (negative pulls in from edge). |
| `children` | `[node, ...]` | Only on container types. Ignored with warning on leaves. |

## Anchor presets

| Name | anchorMin | anchorMax | pivot | Use for |
|---|---|---|---|---|
| `top-left` | (0,1) | (0,1) | (0,1) | Fixed-size element pinned to top-left corner |
| `top` / `top-center` | (0.5,1) | (0.5,1) | (0.5,1) | Fixed-size element centered along the top edge |
| `top-right` | (1,1) | (1,1) | (1,1) | Top-right corner |
| `left` / `middle-left` | (0,0.5) | (0,0.5) | (0,0.5) | Center-left vertically |
| `center` / `middle` | (0.5,0.5) | (0.5,0.5) | (0.5,0.5) | Screen-center. Common default. |
| `right` / `middle-right` | (1,0.5) | (1,0.5) | (1,0.5) | Center-right vertically |
| `bottom-left` | (0,0) | (0,0) | (0,0) | Bottom-left corner |
| `bottom` / `bottom-center` | (0.5,0) | (0.5,0) | (0.5,0) | Bottom center |
| `bottom-right` | (1,0) | (1,0) | (1,0) | Bottom-right corner |
| `top-stretch` | (0,1) | (1,1) | (0.5,1) | Full-width bar pinned to top |
| `middle-stretch` | (0,0.5) | (1,0.5) | (0.5,0.5) | Full-width band vertically centered |
| `bottom-stretch` | (0,0) | (1,0) | (0.5,0) | Full-width bar at bottom |
| `stretch-left` | (0,0) | (0,1) | (0,0.5) | Full-height panel pinned left |
| `stretch-center` | (0.5,0) | (0.5,1) | (0.5,0.5) | Full-height vertical band |
| `stretch-right` | (1,0) | (1,1) | (1,0.5) | Full-height panel pinned right |
| `fill` / `stretch` | (0,0) | (1,1) | (0.5,0.5) | Fill entire parent rect |

## Container types

### `Panel`
Background image + children.

| Field | Type | Default | Notes |
|---|---|---|---|
| `color` | color | semi-dark gray | `"#RRGGBB"`, `"#RRGGBBAA"`, `{"r","g","b","a"}` (0–1 floats), or named (`"white"`, `"black"`, `"red"`, ..., `"clear"`) |
| `sprite` | string \| `{assetRef, subAsset?}` | built-in UISprite | Asset path; auto-9-sliced for panels |

### `VStack` / `HStack` / `Grid`
Transparent container + LayoutGroup. Children are auto-arranged.

| Field | Type | Notes |
|---|---|---|
| `spacing` | number | Px between children |
| `padding` | number \| `[l,t,r,b]` | Single N is uniform; array is `left, top, right, bottom` |
| `childAlignment` | string | `"top-left"`, `"center"`, etc. (9-point grid) |
| `controlChildSize` | bool (default true) | LayoutGroup forces child sizes |
| `childForceExpandWidth` / `childForceExpandHeight` | bool (default false) | Force children to fill available space |
| `fitContent` | bool (default false) | Adds ContentSizeFitter — container grows to fit children |
| `cellSize` | `[w,h]` | Grid only — cell dimensions |

### `ScrollList`
Full ScrollRect + Viewport (masked) + Content (with LayoutGroup). Children go into Content, not the root.

| Field | Type | Notes |
|---|---|---|
| `direction` | `"vertical"` \| `"horizontal"` \| `"both"` | Default vertical |
| `contentLayout` | `"vertical"` \| `"horizontal"` \| `"grid"` | How children in Content are laid out. Default matches `direction`. |
| `spacing` | number | Passed to Content's LayoutGroup |
| `padding` | number \| `[l,t,r,b]` | Passed to Content's LayoutGroup |

## Leaf types

### `Text`
Uses TextMeshProUGUI if available, falls back to UnityEngine.UI.Text.

| Field | Type | Default |
|---|---|---|
| `text` | string | `""` |
| `fontSize` | number | 24 |
| `color` | color | white (TMP) / black (legacy) |
| `alignment` | `"center"`, `"top-left"`, `"middle-right"`, etc. | `center` |

### `Button`
Image + Button + child Text GameObject. targetGraphic auto-wired. onClick NOT auto-wired (use Unity Inspector or `set-property` after creation).

| Field | Type | Default |
|---|---|---|
| `text` | string | `"Button"` |
| `fontSize` | number | 18 |
| `bgColor` | color | light gray |
| `textColor` | color | dark gray |
| `sprite` | string | built-in UISprite |

Default size: 160×40. Override with `size`.

### `Image`

| Field | Type | Default |
|---|---|---|
| `sprite` | string \| `{assetRef, subAsset?}` | none (null — Image is invisible without sprite or non-white color) |
| `color` | color | white |
| `preserveAspect` | bool | false |

For sprite sheets with multiple sprites under one texture, use `{"assetRef": "Assets/Sprites/Sheet.png", "subAsset": "PlayerIdle_0"}` to pick a specific sub-asset.

### `Slider`

| Field | Type | Default |
|---|---|---|
| `min` | number | 0 |
| `max` | number | 1 |
| `value` | number | `min` |
| `whole` | bool | false |
| `direction` | `"left-to-right"`, `"right-to-left"`, `"bottom-to-top"`, `"top-to-bottom"` | `"left-to-right"` |

Default size: 200×20.

### `Toggle`

| Field | Type | Default |
|---|---|---|
| `label` | string | `"Toggle"` |
| `isOn` | bool | false |

Default size: 160×20. Checkbox on left, label on right.

### `InputField`
Legacy InputField (simpler than TMP_InputField). Swap to TMP manually if desired.

| Field | Type | Default |
|---|---|---|
| `placeholder` | string | `"Enter text..."` |
| `text` | string | `""` |

Default size: 200×30.

### `Spacer`
Invisible LayoutElement for pushing siblings apart in a layout group.

| Field | Type | Default |
|---|---|---|
| `flex` | number | 1 |
| `size` | `[w,h]` | optional minimum size |

### `Raw`
Escape hatch: bare RectTransform GameObject + your choice of components.

| Field | Type | Notes |
|---|---|---|
| `components` | `["Namespace.TypeName", ...]` | Types resolved via reflection. Unknown or non-Component types get logged to `warnings[]` and skipped. |

Use for custom MonoBehaviours, or UI patterns the schema doesn't cover.

## Color format

Anywhere `color` is accepted, any of these work:

- `"#RRGGBB"` — e.g. `"#FF6A00"`
- `"#RRGGBBAA"` — with explicit alpha
- `{"r":1, "g":0.5, "b":0, "a":1}` — floats in 0–1 range
- Named: `"white"`, `"black"`, `"red"`, `"green"`, `"blue"`, `"yellow"`, `"cyan"`, `"magenta"`, `"gray"`, `"clear"`

## Result JSON

### `create-ui-tree` returns
```jsonc
{
  "created": true,
  "rootPath": "/Canvas/MainMenu",
  "childrenRemoved": 3,    // only for mode=replace-children
  "warnings": [            // only if any fired
    "Unknown node type 'Fnord' at /Canvas/MainMenu — skipped.",
    "[Raw CustomWidget] Component 'Game.NotAType' not found — skipped."
  ]
}
```

### `inspect-ui-tree` returns
```jsonc
{
  "inspected": true,
  "rootPath": "/Canvas/Menu",
  "tree": { ...nested node spec, round-trippable to create-ui-tree... }
}
```

Note: inspection emits explicit `anchorMin`/`anchorMax`/`pivot`/`sizeDelta` in addition to a `anchor` preset name when one matches. The tree builder accepts both — explicit fields override the preset if both are present.

## Limits + known gaps

- **onClick, onValueChanged, onEndEdit** (UI events) are not wired by this add-on. Post-build, either wire them in Unity's Inspector (one click in the UI) or via `set-property` on the event's `m_PersistentCalls.m_Calls` array (complex — Inspector is faster).
- **TMP_Dropdown**, **TMP_InputField** — built automatically by the `Dropdown` / `InputField` node types when TMP is present (Unity 6's merged UGUI package or `com.unity.textmeshpro`). Legacy equivalents only on projects without TMP. No flag to force one variant — consistency with surrounding text (also TMP via `AddTextComponent`) is the point.
- **Animator on UI** — out of scope. Add via `add-component` after building.
- **UI Toolkit (UXML/USS)** — different system; this add-on is uGUI-only.
