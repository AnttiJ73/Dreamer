# UI conventions for Dreamer-built layouts

Optimize for: first-build legibility, visual editability in Unity afterward, describable structure for follow-up edits.

## Naming

- Name every container with what it represents: `Header`, `Inventory`, `ToolBar`, `AudioSection`. Never `Panel`/`HStack`/`VStack`.
- Name interactive elements uniquely within their parent: `EquipBtn`, `DropBtn`, `UseBtn`. Never three Buttons named "Button".
- Number repeated items: `Quest1`, `Quest2`. Or domain-name them: `Recipe_IronSword`.

## Structure

- Group sections into named sub-Panels, not bare stacks. Sections are the unit of edit — "swap Audio and Display" should mean swapping two named nodes.
- Use the universal panel pattern: VStack with **Header (fixed)** + **Content (flex)** + **Footer (fixed)**. Apply even when only the header exists initially. Easier to grow than retrofit.
- Place by importance top-to-bottom: title, subtitle, content, actions.
- Action buttons at the bottom. Pick a side convention (Confirm right, Cancel left) and stick to it.

## Spacing & sizing

- 8 px grid for padding/spacing/sizes. 4 px for tight visual relationships. Never 7, 13, 19.
- Inner padding on any panel containing content: ≥12 px each side.
- Spacing between siblings in a stack: 8–12 px.
- Spacing between sections: 16–24 px.
- Default loose. Tight = "design is finished and weird"; loose = "scaffold to refine."

## Type scale

Pick 5 sizes, stay on them:

| px | use |
|---|---|
| 12 | captions, counts, helper text |
| 14 | body, descriptions, button labels |
| 18 | list-item titles, prominent labels |
| 24 | section headers |
| 32 | panel titles, modal headers |

## Sizing semantics

`size: [w, h]` inside a LayoutGroup parent:

| spec | meaning |
|---|---|
| `[200, 36]` | locked 200 × 36 |
| `[0, 36]`   | flex width, locked 36 height (typical row) |
| `[200, 0]`  | locked 200 width, flex height (typical column item) |
| `[0, 0]` or omitted | fill both axes (typical content panel) |

One flex child per axis. Multiple flex children share surplus equally — usually wrong. The header/content/footer pattern uses fixed/flex/fixed exactly so content takes the leftover.

## Defensive scaffolding

- Wrap any list or growable content in `ScrollList`. Cost when content fits: invisible. Cost when overflowing without one: broken UI.
- Reserve space for state that doesn't exist yet — lists grow, status text changes, labels translate longer.
- Buttons in a row: equal width via flex (`[0, 36]`) or matching explicit widths.

## Interactive element sizing

Buttons in a single panel: 1–3 size buckets max.

| bucket | size |
|---|---|
| Icon button | 24–32 px square (close, expand, settings cog) |
| Row action | 32–44 px tall, 80–140 px wide (Equip, Buy, Apply) |
| Primary CTA | 48 px+ tall, large or full-width (main commit) |

Seven different button sizes feels random. Two or three buckets feels designed.

## LayoutGroup discipline

- Pick **anchored OR LayoutGroup** per container — never both.
- LayoutGroup owns children's positions. Don't set `anchor` or `offset` on a LayoutGroup child.
- If you need both, the LayoutGroup is at the wrong level. Restructure.

## Spacers

- For pushing children to the far end: `[Title] [Spacer] [CloseBtn]` or `[Cancel] [Spacer] [Apply]`.
- For consistent gaps between children: use the LayoutGroup's `spacing` field. Never empty Spacers.

## Stat bars: Image+Filled, not Slider

Slider is for user-interactive values (volume, brightness). Stat displays use:

```jsonc
{"type": "Panel", "name": "HpBar", "color": "#221619",
 "children": [
   {"type": "Image", "anchor": "fill", "color": "#D14A4A",
    "imageType": "Filled", "fillMethod": "Horizontal", "fillAmount": 0.78}
 ]}
```

## Translation safety

- Don't size buttons to text width. Reserve 30–40% horizontal slack.
- Use flex widths (`[0, 36]`) for button rows where possible.
- Let descriptions wrap. Don't let titles wrap.

## Iteration loop

1. Build with `create-ui-tree`.
2. Inspect with `inspect-ui-tree` to read structure back.
3. Edit JSON, rebuild via `replace-children` on the smallest enclosing target.
4. Always check the result's `warnings[]`.

## See also

- `UNITY-LAYOUT-QUIRKS.md` — Unity behaviors the schema works around. Read when a layout doesn't render the way the spec says.
- `schema.md` in the dreamer-ugui skill — full schema reference.
