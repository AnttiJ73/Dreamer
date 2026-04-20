# Unity UGUI quirks the add-on works around

Reference for debugging unexpected layout behavior or extending the add-on. Each entry: the Unity behavior, the failure mode it produces, the fix in the schema.

Most of these fail silently — inspector values look right, spec looks right, render is wrong.

## 1. LayoutElement skips negative values, falls through to next component

`LayoutUtility.GetLayoutProperty` iterates every `ILayoutElement` on the GameObject and skips any value that's negative (typically `-1`). Falls through to the next-priority component.

**Bites**: setting `LE.preferredHeight = 36` and leaving `LE.flexibleHeight = -1` makes the parent VLG read flex from the underlying HorizontalLayoutGroup (priority 0) — which reports `1` if any child has flex.

**Fix** ([UITreeOps.ApplyAutoLayoutElement](Editor/Operations/UITreeOps.cs)): set BOTH preferred AND flex on every axis with non-negative values:
- `size > 0`: `preferred = size, flex = 0` (locked)
- `size == 0`: `preferred = 0, flex = 1` (fills)

## 2. childForceExpand silently overrides explicit flex

`HorizontalOrVerticalLayoutGroup.GetChildSizes` does `flexible = Mathf.Max(actualFlex, 1)` when forceExpand is on. Every child gets effective `flex >= 1` regardless of LE.

**Bites**: `forceExpand=true` to make Spacers work also force every fixed-size child to claim surplus → all children split evenly.

**Fix** ([UIWidgetOps.AttachLayoutGroup](Editor/Operations/UIWidgetOps.cs)): default `forceExpand = false`. Spacers still work because they have explicit `flex=1` and surplus distributes via `itemFlexibleMultiplier` whenever any child has actual flex>0.

## 3. RectTransform sizeDelta defaults to (100, 100)

Fresh RT created via `new GameObject(..., typeof(RectTransform))` has `sizeDelta = (100, 100)`. For stretched anchors that means "100 px bigger than parent."

**Bites**: `anchor: "fill"` with no explicit size → child is 100 px bigger than parent on each axis. Doesn't visibly bleed (parent clips) but every nested LayoutGroup computes wrong sizes.

**Fix** ([UIHelpers.ApplyRectTransform](Editor/Operations/UIHelpers.cs)): always recompute sizeDelta. Stretched axis with no size → 0. Non-stretched axis with no size → keep current value.

## 4. offsetMin/Max overwrite both axes regardless of stretch state

`rt.offsetMin = (x, y)` sets both axes. Non-stretched axes derive their offsets from sizeDelta + pivot — manual writes overwrite the derived value, often zeroing the panel size on that axis.

**Bites**: side panel `stretch-right` with `size: [420, 0]` and `offsetMin: [0, 100]` — X component clobbers the sizeDelta-derived offset → width = 0.

**Fix** ([UIHelpers.ApplyRectTransform](Editor/Operations/UIHelpers.cs)): apply offsetMin/Max per-axis only on stretched axes. Use `margin: [top, right, bottom, left]` for the user-facing API.

## 5. ScrollRect "both" without horizontal Content fitter

`ContentSizeFitter` only resizes its own GameObject. With Content's `verticalFit = PreferredSize` but `horizontalFit = Unconstrained`, Content stays clamped to Viewport width regardless of children's preferred widths.

**Bites**: pannable map with 1600 px content inside a `direction: "both"` ScrollList can't actually scroll horizontally — Content is locked to ~700.

**Fix** ([UIWidgetOps.CreateScrollList](Editor/Operations/UIWidgetOps.cs)): when direction is `horizontal` or `both`, anchor Content top-left fixed and set `horizontalFit = PreferredSize`.

## 6. Auto-LE skipped size-less children

Same root cause as #1, different symptom. Earlier auto-LE only triggered with `size` present; size-less children had no LE → fell through to LayoutGroup-derived flex (typically 1) → header + size-less ScrollList split height.

**Fix** ([UITreeOps.ApplyAutoLayoutElement](Editor/Operations/UITreeOps.cs)): attach LE to every LayoutGroup child, not just sized ones. Size-less children get `preferred=0, flex=1`.

## 7. ScrollRect's wheel-scroll fights any other IScrollHandler on the same GO

`EventSystem` dispatches `OnScroll` to ALL `IScrollHandler` components on the GameObject. ScrollRect implements IScrollHandler for wheel-scroll; adding another zoom-handler on the same GO means both fire per notch.

**Fix** ([Runtime/MapPanZoom](Runtime/MapPanZoom.cs) + [UIWidgetOps.CreateScrollList](Editor/Operations/UIWidgetOps.cs)): zero `ScrollRect.scrollSensitivity` when MapPanZoom is attached. Drag-pan is unaffected (uses OnDrag, not scrollSensitivity).

## 8. Linear (additive) zoom feels broken across a wide scale range

Adding `±0.1` to scale per notch means at scale 0.3 each notch is a 33% jump; at scale 3.0 each notch is a 3% jump. Zooming in feels glacial; zooming out near min snaps to the floor.

**Fix** ([Runtime/MapPanZoom](Runtime/MapPanZoom.cs)): `newScale = currentScale * Mathf.Pow(1 + zoomSpeed, scrollDelta)`. Multiplicative — each notch moves the same fraction.

## 9. Legacy Dropdown requires legacy Text, not TMP_Text

`UnityEngine.UI.Dropdown.captionText` and `itemText` are typed `Text`. The TMP-preferred `AddTextComponent` returns null on `GetComponent<Text>()` → assignment doesn't crash, but the first `dd.captionText.text = ...` NREs.

**Fix** ([UIWidgetOps.AddLegacyText](Editor/Operations/UIWidgetOps.cs) + `CreateDropdown`): bypass the TMP path with a dedicated `AddLegacyText` helper. For TMP dropdowns, use `Raw` with `components: ["TMPro.TMP_Dropdown"]`.

## 10. RectTransform property-set ordering matters

RT recomputes derived properties on each set. Setting pivot AFTER offsetMin/Max can produce surprising final values.

**Fix**: when building widgets, set in this order: anchor → pivot → size/offsets. Use sizeDelta directly instead of offsets when feasible.

---

## Debugging recipe

When a layout looks wrong:

1. `inspect --scene-object <path>` — verify LE preferred/flex values are non-negative on each axis.
2. Inspect parent LayoutGroup — `controlChildSize` true, `forceExpand` false.
3. Sum children's preferred sizes + spacing + padding. Surplus = innerSize − total. Surplus goes to flex>0 children.
4. ContentSizeFitter sizes its own GO only — doesn't propagate up the hierarchy.
5. If sizeDelta differs from preferred, a LayoutGroup ancestor is sizing the child by its own rules.

The Unity inspector won't show the LayoutGroup's distribution math. Reason about it from LE values + parent settings.
