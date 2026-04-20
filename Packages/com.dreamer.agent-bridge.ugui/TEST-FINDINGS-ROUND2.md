# UGUI add-on — round 2 experiments (2026-04-20)

Built 5 demo canvases in `Assets/Scenes/DreamerUIDemos.unity` covering the user's "what other game UI patterns work?" list. Each is its own Canvas (sortOrder 0-4) anchored to a different region so they're all visible at once.

## Layout fixes shipped this round

Building on round 1, the following bugs are now fixed in source:

1. **Stretched-anchor sizeDelta default zeroed** — `anchor: "fill"` no longer leaves Unity's `(100, 100)` default sizeDelta, which had been making every fill-anchored container 100 px bigger than its parent.
2. **`offsetMin` / `offsetMax` per-axis** — only applied on stretched axes. `offsetMin: [0, 100]` on a vertically-stretched panel no longer zeros the width.
3. **`margin` field added** — CSS-style `[top, right, bottom, left]` (or uniform N, or per-side dict). Compiles to the correct offsetMin/Max for stretched axes only. Inventory panels, sidebars, modals all express their insets cleanly now.
4. **LayoutElement -1 fallthrough** (the big one) — Unity's `LayoutUtility.GetLayoutProperty` skips negative values and falls through to the next ILayoutElement. The auto-attached LayoutElement now sets BOTH preferred AND flex deterministically (size>0 → preferred=N, flex=0; size==0 → preferred=0, flex=1) so the LE always wins over the underlying LayoutGroup. Fixed the QuestLog header expanding to 437 px tall.
5. **`forceExpand=true` defaults on both axes** — safe now because fixed-size children have flex=0 (don't claim surplus). Spacers "just work" without needing per-parent tuning.

Combined effect: the original 6-panel test scene from round 1 renders cleanly without any manual fixes.

## Round 2 experiments

### 1. HUD with image-based bars (replaces Slider) — **works**

The user's ask: instead of `Slider` for HP/MP/XP, build the bar from an Image background + child Image with `Image.Type.Filled` and `fillAmount = 0.78`. New schema fields on Image:

```json
{"type": "Image", "name": "HpFill", "anchor": "fill",
 "color": "#D14A4A",
 "imageType": "Filled",
 "fillMethod": "Horizontal",
 "fillAmount": 0.78,
 "fillOrigin": 0}
```

Also accepts `fillClockwise` (for Radial methods). `fillAmount` auto-promotes `imageType` to `Filled` if not set explicitly.

Built three bars (HP red 78%, MP blue 42%, XP gold 23%) plus their value labels. Verified `HpFill` got `m_Type=Filled, m_FillMethod=Horizontal, m_FillAmount=0.78`.

**Verdict**: cleaner than Slider, easier to skin, predictable rendering. This should be the default pattern for stat bars; Slider is for actual user-interactive values (volume, slider settings).

### 2. Tab navigation bar — **works**

VStack with: HStack of 4 Button (one styled active via different `bgColor`), 3 px Image as gold underline, full-fill content panel below. The "active tab" effect is purely visual (color difference + underline beneath the active button) — no scripting needed for the scaffold.

**Limitation**: the underline is one full-width band, not anchored to the active tab. To make it slide under the active tab, you'd need a positioned child + script to move it. For a static visual scaffold, the band is fine.

### 3. Crafting recipes (sub-lists) — **works**

ScrollList with 4 recipe Panels. Each card has nested layouts:
- Top HStack: icon + name + level requirement
- Middle Text label
- Bottom HStack: ingredient pills (HStack inside Panel inside HStack) + Spacer + Craft/Locked button

Locked recipes use a darker red bg + muted text color. Unlocked use the green Craft button. All nested HStacks/VStacks rendered correctly with the new defaults.

**Verdict**: nested-list pattern works well. The main complexity is keeping the JSON DRY — 4 near-identical recipe blocks make for noisy specs. A future enhancement would be a `repeat: { count: N, template: {...} }` shorthand on container nodes.

### 4. Pannable map with nodes + connection lines — **partial**

Built a 1600×1000 canvas inside a `ScrollList` with `direction: "both"`. 7 location nodes positioned absolutely via `anchor: "top-left"` + `offset: [x, y]`, plus 6 thin Image strips as connection lines (positioned + sized to span between nodes). Player marker as a small yellow square.

**What works**:
- Pan: ScrollList's both-direction scrolling works out of the box.
- Absolute positioning: nodes stay at their assigned coordinates inside the scrollable canvas.
- Connection lines: thin Images (4 px on the perpendicular axis) work as horizontal/vertical connectors.

**What doesn't work yet**:
- Zoom: would need a script (mousewheel handler scales the Content RectTransform). Out of scope for the layout schema; user would add a script.
- Diagonal connectors: would need rotated Images. The schema doesn't expose rotation. For now, only horizontal/vertical lines work.

**Verdict**: solid scaffold for any tile-map / tech-tree / world-map UI. The real gap is rotation, which would let you draw diagonal connectors and other angled elements without resorting to procedural meshes.

### 5. Misc components — **mostly works**

| Widget | Built | Notes |
|---|---|---|
| Stepper | ✓ | HStack: `[-]` button, value Panel, `[+]` button. Clean 3-element row. |
| Dropdown (closed) | ✓ | Panel with label + ▼ glyph as Text. |
| Dropdown (open) | ✓ | Stacked Panels showing options, active one highlighted. Just a visual; real TMP_Dropdown would need `Raw` + `components: ["TMPro.TMP_Dropdown"]`. |
| Drag handle | ✓ | "≡" Unicode glyph in a small Text on the left side of each list row. Pure visual. |
| Color swatches | ✓ | Grid with 12 colored 32×32 Images. Cell-grid layout via the existing Grid type. |

All renders cleanly with the new defaults. The Spacer in the Dropdown HStack works correctly (would have failed before the forceExpand=true default).

## Round 2.1 fixes (in response to user feedback)

After the user tested, three concrete issues + one feature ask:

1. **Map header expanded to fill (same shape as the QuestLog bug we already fixed)** — but the round-1 fix only triggered when the child had `size`. `MapView` had no size, so the auto-LE skipped it, and the header / scroll list ended up sharing height again. **Fix**: auto-LE now attaches to EVERY LayoutGroup child, not just sized ones. Size-less children get `preferred=0, flex=1` (fill). Map header now 38 px tall as specified.

2. **Map content static, nodes outside bounds** — ScrollList with `direction: "both"` was creating a Content that stretched to Viewport width and only had vertical ContentSizeFitter. So MapCanvas (1600 wide) overflowed the ~700-wide Content but the visible area was capped at Content's bounds. **Fix**: when direction includes horizontal, Content's anchor switches to top-left fixed (free to grow horizontally) and ContentSizeFitter gets `horizontalFit = PreferredSize`. Verified MapCanvas's auto-LE reports `preferredWidth=1600, preferredHeight=1000` and Content is now sized to match.

3. **Dropdown should be real, not visual** — agreed. Added `Dropdown` as a first-class node type using `UnityEngine.UI.Dropdown` with full template/viewport/content/item structure. Spec accepts `options: ["a", "b", ...]`, `value: index`, `captionFontSize`, `itemFontSize`. Caveat: legacy Dropdown requires legacy `Text` for caption/item — added an `AddLegacyText` helper that bypasses the TMP-preferred path. (For TMP support the user can swap to `Raw` with `components: ["TMPro.TMP_Dropdown"]`.)

4. **Map zoom** — added a `MapPanZoom` runtime MonoBehaviour in a new `Runtime/` folder with its own asmdef. Implements `IScrollHandler` to respond to mouse wheel and scale the ScrollRect's Content RectTransform. Anchored zoom (point under cursor stays under cursor). Auto-attached when `mapPanZoom: true` is set on a ScrollList spec. Pan is already free via ScrollRect's drag.

Misc demo updated to show **functional** Slider, Toggle, InputField, and two Dropdowns (Difficulty + Class) populated with real options.

## Remaining issues / future work

1. **Diagonal lines / rotated content** — Image rotation isn't exposed in the schema. Blocks: tech-tree diagonal connectors, angled UI badges, rotated minimap arrows. Easy fix: add `rotation` (degrees) to the common-fields block, written to `RectTransform.localEulerAngles.z`.
2. **Zoom** — mousewheel-to-scale on a ScrollList Content needs a script. Could ship a `MapPanZoom` MonoBehaviour with the UGUI add-on, or just document the recipe.
3. **Repeat / template shorthand** — long lists like 5 quests or 7 recipes are noisy in JSON. A `{repeat: 5, template: {...}}` macro would help, but adds parser complexity.
4. **TMP_Dropdown / TMP_InputField** — currently require `Raw` with `components` list. Could promote to first-class types if commonly used.
5. **Drag-and-drop wiring** — purely back-end. The schema produces the visual scaffold; the user adds DragHandler scripts.

## Result-summary

Five demo canvases, ~150 widgets total, zero warnings on build. All five render correctly without manual fixes. The build-time JSON spec is the right level of abstraction for game UI scaffolding; the gaps that remain are either backend (event wiring), specific to advanced patterns (rotation, zoom), or syntactic sugar (repeat).
