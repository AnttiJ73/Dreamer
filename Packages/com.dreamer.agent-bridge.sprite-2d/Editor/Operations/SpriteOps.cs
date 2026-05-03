using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using UnityEditor;
using UnityEditor.U2D.Sprites;
using UnityEngine;
using Dreamer.AgentBridge;

namespace Dreamer.AgentBridge.Sprite2D
{
    /// <summary>Preview + slice sprite-sheet textures. Pairs with core ImporterOps for PPU/filterMode/textureType.</summary>
    public static class SpriteOps
    {
        const string DefaultDir = "DreamerScreenshots";

        // ─── preview-sprite ───────────────────────────────────────────────

        /// <summary>Render a sprite (or a single sub-sprite from a sliced sheet) to PNG. Args: { assetPath?/guid?, subSprite?, savePath?, outlineThickness? }. Default for Multiple mode = sheet with colored rect outlines per sub-sprite.</summary>
        public static CommandResult PreviewSprite(Dictionary<string, object> args)
        {
            string assetPath = AssetOps.ResolveAssetPath(args);
            if (assetPath == null)
                return CommandResult.Fail("Provide 'assetPath' or 'guid'.");

            var texture = AssetDatabase.LoadAssetAtPath<Texture2D>(assetPath);
            if (texture == null)
                return CommandResult.Fail($"Asset is not a texture: {assetPath}");

            var importer = AssetImporter.GetAtPath(assetPath) as TextureImporter;
            string subSpriteName = SimpleJson.GetString(args, "subSprite");
            int outlineThickness = Math.Max(1, Math.Min(8, SimpleJson.GetInt(args, "outlineThickness", 2)));

            var sprites = AssetDatabase.LoadAllAssetRepresentationsAtPath(assetPath)
                .OfType<Sprite>().ToArray();

            Color[] pixels;
            int texW, texH;
            if (!TryReadPixels(texture, out pixels, out texW, out texH, out string readErr))
                return CommandResult.Fail(readErr);

            string savePath = ResolveSavePath(args, $"sprite-{Path.GetFileNameWithoutExtension(assetPath)}");

            if (!string.IsNullOrEmpty(subSpriteName))
            {
                var match = sprites.FirstOrDefault(s => s.name == subSpriteName);
                if (match == null)
                {
                    var available = sprites.Length == 0 ? "(no sub-sprites — texture is Single mode)"
                        : string.Join(", ", sprites.Select(s => s.name));
                    return CommandResult.Fail($"Sub-sprite '{subSpriteName}' not found. Available: {available}");
                }
                var rect = match.rect;
                var outPixels = ExtractRect(pixels, texW, texH, rect);
                var outTex = new Texture2D((int)rect.width, (int)rect.height, TextureFormat.RGBA32, false);
                outTex.SetPixels(outPixels);
                outTex.Apply();
                byte[] subPng = outTex.EncodeToPNG();
                UnityEngine.Object.DestroyImmediate(outTex);
                File.WriteAllBytes(savePath, subPng);

                return CommandResult.Ok(SimpleJson.Object()
                    .Put("path", savePath)
                    .Put("mode", "sub-sprite")
                    .Put("subSprite", subSpriteName)
                    .PutRaw("rect", RectJson(rect).ToString())
                    .Put("width", (int)rect.width)
                    .Put("height", (int)rect.height)
                    .Put("byteCount", subPng.Length)
                    .Put("hint", "Open the PNG with the Read tool to view the sub-sprite.")
                    .ToString());
            }

            // Multiple mode → highlight outline by default (most useful for slicing diagnostics).
            // Single mode → just save the texture as-is.
            bool multipleMode = importer != null && importer.spriteImportMode == SpriteImportMode.Multiple
                                 && sprites.Length > 0;
            var spriteListJson = SimpleJson.Array();
            byte[] png;
            if (multipleMode)
            {
                var palette = BuildPalette();
                for (int i = 0; i < sprites.Length; i++)
                {
                    var s = sprites[i];
                    Color color = palette[i % palette.Length];
                    DrawRectOutline(pixels, texW, texH, s.rect, color, outlineThickness);
                    spriteListJson.AddRaw(SimpleJson.Object()
                        .Put("name", s.name)
                        .PutRaw("rect", RectJson(s.rect).ToString())
                        .Put("color", ColorHex(color))
                        .ToString());
                }
                var compositeTex = new Texture2D(texW, texH, TextureFormat.RGBA32, false);
                compositeTex.SetPixels(pixels);
                compositeTex.Apply();
                png = compositeTex.EncodeToPNG();
                UnityEngine.Object.DestroyImmediate(compositeTex);
            }
            else
            {
                var tex = new Texture2D(texW, texH, TextureFormat.RGBA32, false);
                tex.SetPixels(pixels);
                tex.Apply();
                png = tex.EncodeToPNG();
                UnityEngine.Object.DestroyImmediate(tex);
            }

            File.WriteAllBytes(savePath, png);

            return CommandResult.Ok(SimpleJson.Object()
                .Put("path", savePath)
                .Put("mode", multipleMode ? "highlight" : "single")
                .Put("spriteImportMode", importer?.spriteImportMode.ToString() ?? "n/a")
                .Put("subSpriteCount", sprites.Length)
                .PutRaw("sprites", spriteListJson.ToString())
                .Put("width", texW)
                .Put("height", texH)
                .Put("byteCount", png.Length)
                .Put("hint", multipleMode
                    ? "Open the PNG with Read. Each sub-sprite is outlined in a unique color; map color→name via the `sprites` array."
                    : "Open the PNG with Read. Texture is Single mode (no sub-sprites). Use slice-sprite to slice it.")
                .ToString());
        }

        // ─── slice-sprite ─────────────────────────────────────────────────

        /// <summary>Slice a sprite-sheet texture. Args: { assetPath?/guid?, mode: 'grid'|'auto'|'rects'|'merge', ... }. Sets spriteImportMode=Multiple and reimports.</summary>
        public static CommandResult SliceSprite(Dictionary<string, object> args)
        {
            string assetPath = AssetOps.ResolveAssetPath(args);
            if (assetPath == null)
                return CommandResult.Fail("Provide 'assetPath' or 'guid'.");

            var importer = AssetImporter.GetAtPath(assetPath) as TextureImporter;
            if (importer == null)
                return CommandResult.Fail($"Asset is not a texture: {assetPath}");

            var texture = AssetDatabase.LoadAssetAtPath<Texture2D>(assetPath);
            if (texture == null)
                return CommandResult.Fail($"Failed to load texture: {assetPath}");

            string mode = SimpleJson.GetString(args, "mode");
            if (string.IsNullOrEmpty(mode))
                return CommandResult.Fail("'mode' is required: 'grid' | 'auto' | 'rects' | 'merge'.");

            string namePrefix = SimpleJson.GetString(args, "namePrefix",
                Path.GetFileNameWithoutExtension(assetPath));

            SpriteAlignment alignment = ParseAlignment(SimpleJson.GetString(args, "alignment", "Center"));
            Vector2 customPivot = ParsePivot(args, "pivot", new Vector2(0.5f, 0.5f));

            List<SpriteRect> newRects;
            string err;
            switch (mode.ToLowerInvariant())
            {
                case "grid":
                    if (!TryGridSlice(texture, args, namePrefix, alignment, customPivot, out newRects, out err))
                        return CommandResult.Fail(err);
                    break;
                case "auto":
                    if (!TryAutoSlice(texture, args, namePrefix, alignment, customPivot, out newRects, out err))
                        return CommandResult.Fail(err);
                    break;
                case "rects":
                    if (!TryExplicitRects(args, alignment, customPivot, out newRects, out err))
                        return CommandResult.Fail(err);
                    break;
                case "merge":
                    return MergeSpriteRects(assetPath, args);
                default:
                    return CommandResult.Fail($"Unknown mode '{mode}'. Use grid|auto|rects|merge.");
            }

            return ApplySpriteRects(assetPath, importer, newRects, mode);
        }

        // Skips fully-transparent tiles so empty grid cells don't pollute the rect list.
        static bool TryGridSlice(Texture2D texture, Dictionary<string, object> args,
            string namePrefix, SpriteAlignment alignment, Vector2 customPivot,
            out List<SpriteRect> rects, out string error)
        {
            rects = null;
            error = null;
            Vector2Int cell;
            if (!TryParseInt2(args, "cell", out cell) || cell.x <= 0 || cell.y <= 0)
            {
                error = "'cell' is required for grid mode: {x:cellW, y:cellH} (or '32x32' string).";
                return false;
            }
            TryParseInt2(args, "padding", out Vector2Int padding);
            TryParseInt2(args, "offset", out Vector2Int offset);

            int texW = texture.width;
            int texH = texture.height;
            int stepX = cell.x + padding.x;
            int stepY = cell.y + padding.y;
            if (stepX <= 0 || stepY <= 0)
            {
                error = "padding produces zero/negative step.";
                return false;
            }

            if (!TryReadPixels(texture, out Color[] pixels, out int pxW, out int pxH, out string readErr))
            {
                error = readErr;
                return false;
            }

            rects = new List<SpriteRect>();
            int idx = 0;
            for (int y = texH - cell.y - offset.y; y >= 0; y -= stepY)
            {
                for (int x = offset.x; x + cell.x <= texW; x += stepX)
                {
                    var r = new Rect(x, y, cell.x, cell.y);
                    if (RectIsTransparent(pixels, pxW, pxH, r)) { idx++; continue; }
                    rects.Add(BuildRect($"{namePrefix}_{idx}", r, alignment, customPivot));
                    idx++;
                }
            }

            if (rects.Count == 0)
            {
                error = "Grid produced no rects (all empty?). Check cell/padding/offset.";
                return false;
            }
            return true;
        }

        // Auto: connected-component scan via Unity's internal sprite utility.
        static bool TryAutoSlice(Texture2D texture, Dictionary<string, object> args,
            string namePrefix, SpriteAlignment alignment, Vector2 customPivot,
            out List<SpriteRect> rects, out string error)
        {
            rects = null;
            int minSize = SimpleJson.GetInt(args, "minSize", 16);
            int extrude = SimpleJson.GetInt(args, "extrude", 0);

            if (!texture.isReadable)
            {
                error = "Auto-slice needs a readable texture. Run `set-import-property --asset <path> --property isReadable --value true --wait` first.";
                return false;
            }

            var t = Type.GetType("UnityEditorInternal.InternalSpriteUtility, UnityEditor");
            if (t == null) { error = "InternalSpriteUtility not found in this Unity version."; return false; }
            var m = t.GetMethod("GenerateAutomaticSpriteRectangles",
                BindingFlags.Public | BindingFlags.Static);
            if (m == null) { error = "GenerateAutomaticSpriteRectangles method missing."; return false; }

            Rect[] auto;
            try { auto = (Rect[])m.Invoke(null, new object[] { texture, minSize, extrude }); }
            catch (Exception ex) { error = $"Auto-slice threw: {ex.InnerException?.Message ?? ex.Message}"; return false; }

            rects = new List<SpriteRect>();
            for (int i = 0; i < auto.Length; i++)
                rects.Add(BuildRect($"{namePrefix}_{i}", auto[i], alignment, customPivot));
            if (rects.Count == 0)
            {
                error = "Auto-slice produced no rects (texture empty/uniform, or minSize too large).";
                return false;
            }
            error = null;
            return true;
        }

        static bool TryExplicitRects(Dictionary<string, object> args,
            SpriteAlignment defaultAlignment, Vector2 defaultPivot,
            out List<SpriteRect> rects, out string error)
        {
            rects = null;
            error = null;
            object rectsRaw = SimpleJson.GetValue(args, "rects");
            if (!(rectsRaw is List<object> list) || list.Count == 0)
            {
                error = "'rects' must be a non-empty array of {name, x, y, w, h, alignment?, pivot?} objects.";
                return false;
            }

            rects = new List<SpriteRect>();
            for (int i = 0; i < list.Count; i++)
            {
                if (!(list[i] is Dictionary<string, object> entry))
                {
                    error = $"rects[{i}] is not an object.";
                    return false;
                }
                string name = SimpleJson.GetString(entry, "name", $"Sprite_{i}");
                int x = SimpleJson.GetInt(entry, "x");
                int y = SimpleJson.GetInt(entry, "y");
                int w = SimpleJson.GetInt(entry, "w", SimpleJson.GetInt(entry, "width"));
                int h = SimpleJson.GetInt(entry, "h", SimpleJson.GetInt(entry, "height"));
                if (w <= 0 || h <= 0)
                {
                    error = $"rects[{i}].w/h must be positive (got {w}x{h}).";
                    return false;
                }
                var alignment = ParseAlignment(SimpleJson.GetString(entry, "alignment", defaultAlignment.ToString()));
                var pivot = ParsePivot(entry, "pivot", defaultPivot);
                rects.Add(BuildRect(name, new Rect(x, y, w, h), alignment, pivot));
            }
            return true;
        }

        static CommandResult MergeSpriteRects(string assetPath, Dictionary<string, object> args)
        {
            object groupsRaw = SimpleJson.GetValue(args, "groups");
            if (!(groupsRaw is List<object> groups) || groups.Count == 0)
                return CommandResult.Fail("'groups' must be a non-empty array of {keep, absorb} objects.");

            var dataProvider = GetSpriteDataProvider(assetPath, out string dpErr);
            if (dataProvider == null) return CommandResult.Fail(dpErr);

            var existing = dataProvider.GetSpriteRects().ToList();
            if (existing.Count == 0)
                return CommandResult.Fail("Texture has no existing sprite rects to merge. Slice first with grid|auto|rects.");

            int mergesApplied = 0;
            var summary = SimpleJson.Array();
            for (int gi = 0; gi < groups.Count; gi++)
            {
                if (!(groups[gi] is Dictionary<string, object> group))
                    return CommandResult.Fail($"groups[{gi}] is not an object.");
                string keepName = SimpleJson.GetString(group, "keep", $"Merged_{gi}");
                if (!(SimpleJson.GetValue(group, "absorb") is List<object> absorbList) || absorbList.Count < 2)
                    return CommandResult.Fail($"groups[{gi}].absorb must be a list of 2+ existing rect names.");

                var absorbNames = absorbList.OfType<string>().ToList();
                var matches = existing.Where(r => absorbNames.Contains(r.name)).ToList();
                var missing = absorbNames.Except(matches.Select(m => m.name)).ToList();
                if (missing.Count > 0)
                    return CommandResult.Fail($"groups[{gi}]: rects not found: {string.Join(", ", missing)}. " +
                        $"Available: {string.Join(", ", existing.Select(r => r.name))}");

                Rect union = matches[0].rect;
                for (int i = 1; i < matches.Count; i++)
                    union = UnionRect(union, matches[i].rect);

                foreach (var m in matches) existing.Remove(m);
                var merged = new SpriteRect
                {
                    name = keepName,
                    rect = union,
                    alignment = matches[0].alignment,
                    pivot = matches[0].pivot,
                    border = Vector4.zero,
                    spriteID = GUID.Generate()
                };
                existing.Add(merged);
                mergesApplied++;
                summary.AddRaw(SimpleJson.Object()
                    .Put("keep", keepName)
                    .Put("absorbed", absorbNames.Count)
                    .PutRaw("rect", RectJson(union).ToString())
                    .ToString());
            }

            dataProvider.SetSpriteRects(existing.ToArray());
            dataProvider.Apply();
            (dataProvider.targetObject as AssetImporter)?.SaveAndReimport();

            return CommandResult.Ok(SimpleJson.Object()
                .Put("merged", true)
                .Put("groupsApplied", mergesApplied)
                .Put("totalRectsAfter", existing.Count)
                .PutRaw("summary", summary.ToString())
                .ToString());
        }

        static CommandResult ApplySpriteRects(string assetPath, TextureImporter importer,
            List<SpriteRect> rects, string mode)
        {
            // Slicing requires Multiple mode; flip silently if the asset was Single.
            bool wasSingle = importer.spriteImportMode != SpriteImportMode.Multiple;
            if (wasSingle) importer.spriteImportMode = SpriteImportMode.Multiple;

            var dataProvider = GetSpriteDataProvider(assetPath, out string dpErr);
            if (dataProvider == null) return CommandResult.Fail(dpErr);

            // Preserve spriteID for rects whose name matches an existing one — keeps prefab/anim references.
            var existing = dataProvider.GetSpriteRects();
            var existingByName = existing.ToDictionary(r => r.name, r => r.spriteID);
            foreach (var r in rects)
            {
                if (existingByName.TryGetValue(r.name, out var id)) r.spriteID = id;
            }

            dataProvider.SetSpriteRects(rects.ToArray());
            dataProvider.Apply();
            importer.SaveAndReimport();

            return CommandResult.Ok(SimpleJson.Object()
                .Put("sliced", true)
                .Put("mode", mode)
                .Put("rectsCreated", rects.Count)
                .Put("flippedToMultipleMode", wasSingle)
                .Put("hint", "Run `preview-sprite --asset <path>` to view the result with rect highlights.")
                .ToString());
        }

        static ISpriteEditorDataProvider GetSpriteDataProvider(string assetPath, out string error)
        {
            error = null;
            var factory = new SpriteDataProviderFactories();
            factory.Init();
            var importer = AssetImporter.GetAtPath(assetPath);
            if (importer == null) { error = $"No importer for {assetPath}"; return null; }
            var dp = factory.GetSpriteEditorDataProviderFromObject(importer);
            if (dp == null) { error = $"No SpriteEditorDataProvider for {assetPath} (asset type doesn't support sprites?)"; return null; }
            dp.InitSpriteEditorDataProvider();
            return dp;
        }

        // ─── helpers ──────────────────────────────────────────────────────

        // Round-trips through a RenderTexture so non-readable textures still work — the
        // alternative (toggling isReadable + reimport) mutates the asset's import settings.
        static bool TryReadPixels(Texture2D source, out Color[] pixels, out int width, out int height, out string error)
        {
            pixels = null; width = 0; height = 0; error = null;
            width = source.width;
            height = source.height;

            var prevActive = RenderTexture.active;
            var rt = RenderTexture.GetTemporary(width, height, 0, RenderTextureFormat.ARGB32, RenderTextureReadWrite.sRGB);
            try
            {
                Graphics.Blit(source, rt);
                RenderTexture.active = rt;
                var tmp = new Texture2D(width, height, TextureFormat.RGBA32, false);
                tmp.ReadPixels(new Rect(0, 0, width, height), 0, 0);
                tmp.Apply();
                pixels = tmp.GetPixels();
                UnityEngine.Object.DestroyImmediate(tmp);
                return true;
            }
            catch (Exception ex)
            {
                error = $"Failed to read texture pixels: {ex.Message}";
                return false;
            }
            finally
            {
                RenderTexture.active = prevActive;
                RenderTexture.ReleaseTemporary(rt);
            }
        }

        static Color[] ExtractRect(Color[] pixels, int texW, int texH, Rect r)
        {
            int x0 = Mathf.Clamp((int)r.x, 0, texW);
            int y0 = Mathf.Clamp((int)r.y, 0, texH);
            int w = Mathf.Clamp((int)r.width, 0, texW - x0);
            int h = Mathf.Clamp((int)r.height, 0, texH - y0);
            var sub = new Color[w * h];
            for (int y = 0; y < h; y++)
            for (int x = 0; x < w; x++)
                sub[y * w + x] = pixels[(y0 + y) * texW + (x0 + x)];
            return sub;
        }

        static void DrawRectOutline(Color[] pixels, int texW, int texH, Rect r, Color color, int thickness)
        {
            int x0 = Mathf.Clamp((int)r.x, 0, texW - 1);
            int y0 = Mathf.Clamp((int)r.y, 0, texH - 1);
            int x1 = Mathf.Clamp((int)(r.x + r.width) - 1, 0, texW - 1);
            int y1 = Mathf.Clamp((int)(r.y + r.height) - 1, 0, texH - 1);

            for (int t = 0; t < thickness; t++)
            {
                if (y0 + t <= y1) for (int x = x0; x <= x1; x++) pixels[(y0 + t) * texW + x] = color;
                if (y1 - t >= y0) for (int x = x0; x <= x1; x++) pixels[(y1 - t) * texW + x] = color;
                if (x0 + t <= x1) for (int y = y0; y <= y1; y++) pixels[y * texW + (x0 + t)] = color;
                if (x1 - t >= x0) for (int y = y0; y <= y1; y++) pixels[y * texW + (x1 - t)] = color;
            }
        }

        static bool RectIsTransparent(Color[] pixels, int texW, int texH, Rect r)
        {
            int x0 = Mathf.Clamp((int)r.x, 0, texW);
            int y0 = Mathf.Clamp((int)r.y, 0, texH);
            int x1 = Mathf.Clamp((int)(r.x + r.width), 0, texW);
            int y1 = Mathf.Clamp((int)(r.y + r.height), 0, texH);
            for (int y = y0; y < y1; y++)
                for (int x = x0; x < x1; x++)
                    if (pixels[y * texW + x].a > 0.01f) return false;
            return true;
        }

        static SpriteRect BuildRect(string name, Rect rect, SpriteAlignment alignment, Vector2 customPivot)
        {
            return new SpriteRect
            {
                name = name,
                rect = rect,
                alignment = alignment,
                pivot = alignment == SpriteAlignment.Custom ? customPivot : DefaultPivot(alignment),
                border = Vector4.zero,
                spriteID = GUID.Generate(),
            };
        }

        static Rect UnionRect(Rect a, Rect b)
        {
            float xMin = Mathf.Min(a.xMin, b.xMin);
            float yMin = Mathf.Min(a.yMin, b.yMin);
            float xMax = Mathf.Max(a.xMax, b.xMax);
            float yMax = Mathf.Max(a.yMax, b.yMax);
            return new Rect(xMin, yMin, xMax - xMin, yMax - yMin);
        }

        static SpriteAlignment ParseAlignment(string s)
        {
            if (string.IsNullOrEmpty(s)) return SpriteAlignment.Center;
            switch (s.Trim().ToLowerInvariant().Replace("-", "").Replace("_", ""))
            {
                case "center":      return SpriteAlignment.Center;
                case "topleft":     return SpriteAlignment.TopLeft;
                case "topcenter":   return SpriteAlignment.TopCenter;
                case "topright":    return SpriteAlignment.TopRight;
                case "leftcenter":  return SpriteAlignment.LeftCenter;
                case "rightcenter": return SpriteAlignment.RightCenter;
                case "bottomleft":  return SpriteAlignment.BottomLeft;
                case "bottomcenter":return SpriteAlignment.BottomCenter;
                case "bottomright": return SpriteAlignment.BottomRight;
                case "custom":      return SpriteAlignment.Custom;
                default:            return SpriteAlignment.Center;
            }
        }

        static Vector2 DefaultPivot(SpriteAlignment a)
        {
            switch (a)
            {
                case SpriteAlignment.TopLeft:      return new Vector2(0f, 1f);
                case SpriteAlignment.TopCenter:    return new Vector2(0.5f, 1f);
                case SpriteAlignment.TopRight:     return new Vector2(1f, 1f);
                case SpriteAlignment.LeftCenter:   return new Vector2(0f, 0.5f);
                case SpriteAlignment.RightCenter:  return new Vector2(1f, 0.5f);
                case SpriteAlignment.BottomLeft:   return new Vector2(0f, 0f);
                case SpriteAlignment.BottomCenter: return new Vector2(0.5f, 0f);
                case SpriteAlignment.BottomRight:  return new Vector2(1f, 0f);
                default:                            return new Vector2(0.5f, 0.5f);
            }
        }

        static Vector2 ParsePivot(Dictionary<string, object> dict, string key, Vector2 fallback)
        {
            object raw = SimpleJson.GetValue(dict, key);
            if (raw == null) return fallback;
            if (raw is List<object> list && list.Count >= 2)
            {
                return new Vector2(ToFloat(list[0]), ToFloat(list[1]));
            }
            if (raw is Dictionary<string, object> obj)
            {
                return new Vector2(SimpleJson.GetFloat(obj, "x", fallback.x), SimpleJson.GetFloat(obj, "y", fallback.y));
            }
            return fallback;
        }

        // Accepts {x:N, y:N} OR [N, N] OR string "WxH" / "W,H".
        static bool TryParseInt2(Dictionary<string, object> dict, string key, out Vector2Int result)
        {
            result = Vector2Int.zero;
            object raw = SimpleJson.GetValue(dict, key);
            if (raw == null) return false;
            if (raw is Dictionary<string, object> obj)
            {
                result = new Vector2Int(SimpleJson.GetInt(obj, "x"), SimpleJson.GetInt(obj, "y"));
                return true;
            }
            if (raw is List<object> list && list.Count >= 2)
            {
                result = new Vector2Int((int)ToFloat(list[0]), (int)ToFloat(list[1]));
                return true;
            }
            if (raw is string s)
            {
                var parts = s.Split(new[] { 'x', 'X', ',', ' ' }, StringSplitOptions.RemoveEmptyEntries);
                if (parts.Length >= 2 && int.TryParse(parts[0], out int a) && int.TryParse(parts[1], out int b))
                {
                    result = new Vector2Int(a, b);
                    return true;
                }
            }
            return false;
        }

        static float ToFloat(object o)
        {
            if (o is double d) return (float)d;
            if (o is int i) return i;
            if (o is long l) return l;
            if (o is float f) return f;
            return 0f;
        }

        static Color[] BuildPalette()
        {
            return new[]
            {
                new Color(1f, 0.2f, 0.2f, 1f),
                new Color(0.2f, 0.8f, 1f, 1f),
                new Color(0.2f, 1f, 0.4f, 1f),
                new Color(1f, 0.8f, 0.2f, 1f),
                new Color(1f, 0.4f, 1f, 1f),
                new Color(0.4f, 0.4f, 1f, 1f),
                new Color(1f, 0.6f, 0.2f, 1f),
                new Color(0.2f, 1f, 0.9f, 1f),
            };
        }

        static string ColorHex(Color c)
        {
            return $"#{(int)(c.r * 255):X2}{(int)(c.g * 255):X2}{(int)(c.b * 255):X2}";
        }

        static JsonBuilder RectJson(Rect r)
        {
            return SimpleJson.Object()
                .Put("x", (int)r.x).Put("y", (int)r.y)
                .Put("width", (int)r.width).Put("height", (int)r.height);
        }

        static string ResolveSavePath(Dictionary<string, object> args, string baseName)
        {
            string savePath = SimpleJson.GetString(args, "savePath");
            if (!string.IsNullOrEmpty(savePath))
            {
                string parent = Path.GetDirectoryName(savePath);
                if (!string.IsNullOrEmpty(parent)) Directory.CreateDirectory(parent);
                return savePath;
            }
            if (!Directory.Exists(DefaultDir)) Directory.CreateDirectory(DefaultDir);
            string giPath = Path.Combine(DefaultDir, ".gitignore");
            if (!File.Exists(giPath))
                File.WriteAllText(giPath, "# Auto-generated.\n*\n!.gitignore\n");
            return Path.Combine(DefaultDir, $"{baseName}-{DateTime.UtcNow.Ticks}.png").Replace('\\', '/');
        }
    }
}
