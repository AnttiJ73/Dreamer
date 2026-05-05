---
name: dreamer-sprite
description: Slice, preview, and validate Unity sprite-sheet textures via Dreamer's sprite-2d add-on. Use whenever the task involves sub-sprite authoring on a Texture2D — grid/auto/explicit-rects slicing, composite-island merging, non-destructive re-slicing after artist edits (extend), TextureImporter property tweaks (PPU, filterMode, isReadable, textureType), or visual verification of a sliced sheet. Activated by mentions of sprite sheet, sliced sprites, sprite atlas, sprite slicing, sprite preview, sprite alignment, pivot, PPU, pixels per unit, filter mode, or composite sprite.
---

# Dreamer — Sprite-2D add-on

Optional add-on. Ships sprite-sheet authoring + verification commands that depend on Unity's `com.unity.2d.sprite` package. Lives at `Packages/com.dreamer.agent-bridge.sprite-2d/`. Don't use this for runtime sprite reference assignment — that's `set-property` with `{"assetRef":..., "subAsset":...}` (see the core dreamer skill's `property-values.md`).

If you forget the exact verb, run `./bin/dreamer search "<query>"` (`search slice`, `search "sprite preview"`, `search ppu`). Search covers add-on schemas alongside core.

## Commands

| Command | Use for |
|---|---|
| `slice-sprite` | Author the sub-sprite rects on a Texture2D. Four modes: `grid`, `auto`, `rects`, `merge`. **Destructive** for grid/auto/rects (overwrites the spritesheet); **non-destructive** for merge. |
| `extend-sprite` | Re-slice a sheet after artist edits WITHOUT losing rect names or `spriteID`s. Preserves every prefab / animation / Animator reference. Use this — not `slice-sprite` — whenever the sheet already had rects and you only want to add or realign. |
| `preview-sprite` | Render the texture (or one named sub-sprite) to PNG. Highlight mode draws colored rect outlines + a `sprites[]` legend. Open the PNG with the Read tool to view. |
| `validate-sprite` | Run all eight sanity checks on demand. Same `validation` field auto-attaches to every slice/extend/merge result. |
| `set-import-property` | Set any AssetImporter property by name (TextureImporter / ModelImporter / AudioImporter / …). Used here for `isReadable`, `spritePixelsPerUnit`, `filterMode`, `textureType`. **Ships in core, not the add-on** — works without sprite-2d installed. |

## Hard rules

- **Always pass `--wait`** on slice / extend / merge / validate / set-import-property — you need the result before proceeding.
- **Set `isReadable=true`** before `slice-sprite --mode auto` or `extend-sprite`. Both scan pixel content; un-readable textures fail with that hint.
  ```bash
  ./bin/dreamer set-import-property --asset PATH --property isReadable --value true --wait
  ```
- **Prefer `extend-sprite` over `slice-sprite`** for any sheet that already has rects. Slicing in grid/auto/rects mode regenerates spriteIDs — every prefab/animation reference to the old sub-sprites breaks. Extend preserves IDs.
- **Always check `result.validation.warnings[]`** after slice/extend/merge. The validator pre-computes fixes for `partially_clipped`, `low_density`, and `orphan_pixels` — read `suggestedRect` / `suggestedName` / `suggestedFix` and apply via `slice-sprite --mode rects` or `extend-sprite`.
- **Verify visually after authoring**: `preview-sprite --asset PATH --wait` then Read the returned PNG. The highlight-mode `sprites[]` legend maps each rect to its outline color.

## Modes (slice-sprite)

| mode | Effect | Required args |
|---|---|---|
| `grid` | Fixed cell W×H, top-row first | `--cell WxH` (plus optional `--padding`, `--offset`) |
| `auto` | Connected-component scan; one rect per opaque island | `isReadable=true`; optional `--min-size N` (default 16), `--extrude N` |
| `rects` | Explicit JSON `[{name, x, y, w, h, alignment?, pivot?}]` | `--rects '[…]'` |
| `merge` | **Non-destructive**. Combine existing rects into a union-bbox rect. For composite islands (character + shadow + weapon as one logical sprite). | `--groups '[{"keep":"NewName","absorb":["a","b","c"]}]'` |

## Quick recipes

```bash
# 1. Make a fresh sheet authoring-ready
./bin/dreamer set-import-property --asset Assets/Sheet.png --property textureType    --value '"Sprite"' --wait
./bin/dreamer set-import-property --asset Assets/Sheet.png --property filterMode     --value '"Point"'  --wait    # pixel art
./bin/dreamer set-import-property --asset Assets/Sheet.png --property spritePixelsPerUnit --value 16    --wait
./bin/dreamer set-import-property --asset Assets/Sheet.png --property isReadable     --value true       --wait

# 2. Auto-slice into per-island rects
./bin/dreamer slice-sprite --asset Assets/Sheet.png --mode auto --min-size 32 --wait

# 3. Visually verify
./bin/dreamer preview-sprite --asset Assets/Sheet.png --wait        # writes PNG, returns sprites[]

# 4. Combine composite islands (e.g. "auto_3" + "auto_4" + "auto_5" are one character)
./bin/dreamer slice-sprite --asset Assets/Sheet.png --mode merge \
  --groups '[{"keep":"Player_Idle","absorb":["auto_3","auto_4","auto_5"]}]' --wait

# 5. Artist edits the sheet (canvas resize, new sprites added, content moved). Re-slice without breaking references:
./bin/dreamer extend-sprite --asset Assets/Sheet.png --wait
```

## Extend-sprite — four-pass orphan recovery

The whole reason this command exists is to keep `spriteID`s stable across artist edits so prefabs / animations / Animators don't break. Recovery passes (in cost order):

1. **IoU vs auto-detected islands** — handles "new sprites added in whitespace". Existing rects keep names + IDs; positions snap to the matched island's exact bounds.
2. **Candidate-restricted template match** — for unmatched existing rects, pixel-matches cached pre-edit content against current islands of similar size (±10%). Handles individual sprite relocations.
3. **Coherent-motion guess** — computes median (dx, dy) across all successful matches; tries `oldPos + medianDelta` for remaining orphans. Catches merged-bbox composite rects that span multiple islands and don't fit the size band.
4. **Brute-force scan** — slides the template across all positions with sample-pixel early-exit; tie-breaks by proximity to the median-delta hint to avoid arbitrary picks on repetitive content (tilesets).

Unmatched detected islands → appended as new rects (`<prefix>_<N>`). Still-unmatched existing rects → reported as `orphanedRects[]`, kept in place. Read those, decide whether the artist deleted them or redrew them, then either delete the rect (`slice-sprite --mode rects` without it) or accept the new auto-detected island in its place.

**Cache prerequisite**: every successful slice / extend operation auto-writes per-rect PNGs to `Library/Dreamer/SpriteSlices/<assetGuid>/`. The cache is what passes 2–4 match against. If the asset was sliced *before* this tooling shipped, run `extend-sprite` once on the unchanged sheet to bootstrap the cache, *then* let the artist edit, *then* run `extend-sprite` again. The first extend after a Library wipe has only IoU-matching available — `result.cacheAvailable: false` flags this.

## Auto-validation (every slice/extend/merge attaches `validation`)

Every successful authoring op runs eight checks against the post-op state and attaches `validation: { ok, summary, count, warnings[] }`. `validate-sprite --asset PATH --wait` runs the same checks on demand for sheets you didn't author this session.

| Severity | Kind | Means |
|---|---|---|
| **error** | `out_of_bounds` | Rect extends past texture |
| **error** | `duplicate_name` | Two rects share a name — Unity lookups become ambiguous |
| **warn** | `empty_rect` | Zero opaque pixels — usually a stale rect after the artist deleted content |
| **warn** | `partially_clipped` | Boundary cuts through opaque content. **Has `suggestedRect`** (flood-filled true bbox) + `suggestedFix` ("Widen to …") |
| **warn** | `orphan_pixels` | ≥64-pixel opaque island not inside any rect — content forgot to slice. **Has `suggestedRect` + `suggestedName`** (next index in dominant `<prefix>_<N>` pattern) + `suggestedFix` ("Add rect … named …") |
| **info** | `overlap` | Rects intersect — intentional for merge-bbox composites; investigate otherwise |
| **info** | `low_density` | <5% opaque pixels in rect. **Has `suggestedRect`** (tight bbox) + `suggestedFix` ("Tighten to …") |
| **info** | `tiny_rect` | <4px on a side |

The pre-computed `suggestedRect` / `suggestedName` / `suggestedFix` fields exist so the LLM doesn't re-scan the pixels — apply them directly. Severity tiers let you filter: errors must be fixed; warns are likely bugs; info is anomaly-detection (overlap on merge-bbox composites is normal).

`orphan_pixels` and content checks need `isReadable=true`. Without it the geometry checks (`out_of_bounds`, `duplicate_name`, `tiny_rect`, `overlap`) still run; content checks surface as a `pixel_read_failed` info entry.

## Preview modes

`preview-sprite --asset PATH` — three modes auto-selected by texture state:

| Mode | When | Output |
|---|---|---|
| `single` | Texture is Single mode (no slicing) | Full texture as PNG |
| `highlight` | Texture is Multiple mode | Full texture with colored outlines per sub-sprite + `sprites[]: [{name, rect, color}]` legend |
| `sub-sprite` | `--sub-sprite NAME` passed | Just that one rect, cropped, with its alignment/pivot honored |

Preview round-trips through a RenderTexture so it does NOT mutate `isReadable`. Slicing's `auto` mode is the one that actually requires readable.

## Wiring sprites onto components

Out of scope for this add-on. Use the core `set-property` with sub-asset reference:

```bash
./bin/dreamer set-property --asset Assets/Prefabs/Hero.prefab --component SpriteRenderer \
  --property m_Sprite --value '{"assetRef":"Assets/Sheet.png","subAsset":"Hero_Idle_0"}' --wait
```

For animation sprite swaps see the animation add-on's `set-sprite-curve`.

## When the add-on is missing

If `slice-sprite` / `preview-sprite` / `extend-sprite` / `validate-sprite` returns "Unknown command kind: …", tell the user:

> To enable sprite-sheet tooling, run: `./bin/dreamer addon install sprite-2d`

`set-import-property` ships in core and works regardless — it's the generic AssetImporter setter, not sprite-specific.

## Build-time gotchas

- **Y axis is texture pixel-space (bottom-left origin in Unity)**, but grid mode iterates top-row to bottom to match Unity's "Slice Grid By Cell Size" naming convention. Visual position in `preview-sprite` matches Unity's Sprite Editor.
- **Merge mode keeps the FIRST absorbed rect's alignment + pivot**. If you need a different anchor on the merged result, follow up with `slice-sprite --mode rects` to override.
- **Property names on `set-import-property` are case-sensitive C# names** (`filterMode`, `isReadable`, `spritePixelsPerUnit` — NOT `m_FilterMode` or `pixelsPerUnit`). Misses error with the full writable-property list for the importer subclass.
- **Enum values on `set-import-property` pass as JSON-quoted strings**: `--value '"Point"'`, NOT `--value Point`. JSON quoting matters.
- **`extend-sprite` cache lives in `Library/Dreamer/SpriteSlices/<guid>/`** — gitignored, lost on Library wipe. The next slice/extend after a wipe rebuilds it.
- **Don't slice before checking compile-status** if your project has compile errors blocking import: a fresh import may be required and Unity gates it.
