# `set-property` value formats

Detailed reference for the `--value` flag on `set-property`. Cheat sheet:

| Field type | `--value` shape |
|---|---|
| Primitive (int/float/bool/string) | `'10'`, `'1.5'`, `'true'`, `'"text"'` |
| Vector2/3/4 | `'{"x":1,"y":2,"z":0}'` |
| Color | `'{"r":1,"g":0,"b":0,"a":1}'` |
| Asset reference | `'{"assetRef":"Assets/Path/X.prefab"}'` |
| Sub-asset (sprite in atlas) | `'{"assetRef":"Assets/Sheet.png","subAsset":"Idle_0"}'` |
| Scene object reference | `'{"sceneRef":"Main Camera"}'` |
| Self / sibling component | `'{"self":true,"component":"PlayerController"}'` |
| Self / descendant | `'{"selfChild":"Visuals/Hand","component":"SpriteRenderer"}'` |
| Clear reference | `'null'` |
| Array (full replace) | `'[1, 2, 3]'` or `'[{"a":1},{"a":2}]'` |
| Array (sparse update) | `'{"_size":4,"0":{"a":1},"3":{"a":9}}'` |
| Nested struct | `'{"field":42,"nested":{"inner":"ok"}}'` |

## Property Names for built-in Unity components

Built-in components (`Transform`, `SpriteRenderer`, `Collider`, `Camera`, etc.) serialize fields as `m_Pascal` (e.g. `m_Sprite`, `m_LocalPosition`). Dreamer accepts the C# camelCase form — `sprite`, `localPosition`, `color`, `isTrigger` — and falls back to `m_Sprite` etc. on lookup failure. User-defined `[SerializeField]` fields keep their declared name as-is. The result JSON includes `resolvedPath` so you can verify which form Unity used.

## Array / List access (`entries[N]` shorthand)

Unity's canonical SerializedProperty path for an array element is `entries.Array.data[24]`, but `set-property` accepts the user-friendly `entries[24]` form and rewrites internally. Works for nested paths too: `entries[24].itemGuid`.

For appending (target index ≥ current length), use the sparse-update form — `FindProperty` returns null for non-existent indices, so direct `entries[N]` only works for indices that already exist:

```bash
# Append a new element at index 24 (assuming current length is 24)
./bin/dreamer set-property --asset Assets/Data/Registry.asset \
  --property entries \
  --value '{"_size":25,"24":{"id":"new","prefab":{"assetRef":"Assets/Prefabs/X.prefab"}}}' --wait
```

Pass an empty `[]` to clear an array entirely. Pass a full `[...]` to replace it (existing elements are dropped).

## Sub-asset references (sprites inside a Texture2D)

Sprite sheets have a Texture2D main asset plus Sprite sub-assets. Assigning a Sprite-typed field needs the sub-asset, not the texture:

```bash
# Explicit by name (required for Multiple-mode sprite atlases)
--value '{"assetRef":"Assets/Sprites/Characters.png","subAsset":"PlayerIdle_0"}'

# Single-sprite mode — Dreamer auto-picks the only Sprite sub-asset
--value '{"assetRef":"Assets/Sprites/Square.png"}'
```

If field type can't be resolved via reflection (common for built-in components like SpriteRenderer), Dreamer probes each sub-asset and picks the one Unity accepts. Multiple compatible candidates → Dreamer errors with a list; specify `subAsset` to disambiguate.

## Scene object path rules

Used by `--scene-object` and the `sceneRef` value form.

- `"/Root/Child/Grandchild"` — absolute: first segment MUST be a root-level object. No fallback.
- `"Root/Child"` — same as absolute (first segment is a root name). One match required.
- `"Grandchild"` — bare name: recursive search across **all loaded scenes** (active + additive). Returns an error if the name is ambiguous, listing every matching path so you can qualify it.
- `"Parent/Grandchild"` — bare prefix: recursive search anywhere that chain matches.

Ambiguity is an error, not a silent misroute. On collision, the CLI fails with matching paths so you can pick one.

## `m_Name` is NOT settable via `set-property`

`m_Name` lives on the GameObject anchor, not a component. `./bin/dreamer set-property --property m_Name` returns a directive error pointing at `rename`. Use:

```bash
./bin/dreamer rename --scene-object PATH --name NEW_NAME --wait
./bin/dreamer rename --asset PREFAB.prefab [--child-path SUB] --name NEW_NAME --wait
```
