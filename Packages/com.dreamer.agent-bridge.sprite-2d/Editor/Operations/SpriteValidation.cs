using System;
using System.Collections.Generic;
using System.Linq;
using UnityEditor;
using UnityEditor.U2D.Sprites;
using UnityEngine;
using Dreamer.AgentBridge;

namespace Dreamer.AgentBridge.Sprite2D
{
    /// <summary>Auto-run safety checks on a sliced sprite sheet — surface issues an LLM would otherwise discover by trial and error.</summary>
    public static class SpriteValidation
    {
        const int OrphanMinPixels = 64;     // 8x8 — below this is treated as anti-aliasing dust, not lost art.
        const int TinyRectThreshold = 4;
        const float LowDensityThreshold = 0.05f;

        public class Warning
        {
            public string Kind;
            public string Severity;
            public string RectName;
            public Rect? Rect;
            public string Message;
            public Dictionary<string, object> Detail;
        }

        public class Report
        {
            public List<Warning> Warnings = new List<Warning>();
            public bool Ok => !Warnings.Any(w => w.Severity == "error" || w.Severity == "warn");
            public Dictionary<string, int> CountByKind => Warnings
                .GroupBy(w => w.Kind)
                .ToDictionary(g => g.Key, g => g.Count());
        }

        public static Report Validate(string assetPath)
        {
            var report = new Report();
            var importer = AssetImporter.GetAtPath(assetPath) as TextureImporter;
            var texture = AssetDatabase.LoadAssetAtPath<Texture2D>(assetPath);
            if (importer == null || texture == null)
            {
                report.Warnings.Add(new Warning {
                    Kind = "load_failed", Severity = "error",
                    Message = $"Could not load TextureImporter or Texture2D at {assetPath}.",
                });
                return report;
            }

            ISpriteEditorDataProvider dp = SpriteOps.GetSpriteDataProvider(assetPath, out string dpErr);
            if (dp == null)
            {
                report.Warnings.Add(new Warning {
                    Kind = "load_failed", Severity = "error",
                    Message = dpErr ?? "No sprite data provider for this asset.",
                });
                return report;
            }

            var rects = dp.GetSpriteRects();
            if (rects == null || rects.Length == 0) return report;

            int W = texture.width;
            int H = texture.height;

            CheckOutOfBounds(rects, W, H, report);
            CheckDuplicateNames(rects, report);
            CheckTinyRects(rects, report);
            CheckOverlaps(rects, report);

            if (!SpriteOps.TryReadPixels(texture, out Color[] pixels, out int pxW, out int pxH, out string readErr))
            {
                report.Warnings.Add(new Warning {
                    Kind = "pixel_read_failed", Severity = "info",
                    Message = $"Couldn't read pixels for content checks: {readErr}. Geometry checks ran; content checks skipped.",
                });
                return report;
            }

            CheckEmptyAndLowDensity(rects, pixels, pxW, pxH, report);
            CheckPartiallyClipped(rects, pixels, pxW, pxH, report);
            CheckOrphanPixels(rects, pixels, pxW, pxH, report);

            return report;
        }

        // ─── geometry checks (no pixel reads) ─────────────────────────────

        static void CheckOutOfBounds(SpriteRect[] rects, int W, int H, Report report)
        {
            foreach (var r in rects)
            {
                if (r.rect.x < 0 || r.rect.y < 0 || r.rect.xMax > W || r.rect.yMax > H)
                {
                    report.Warnings.Add(new Warning {
                        Kind = "out_of_bounds", Severity = "error",
                        RectName = r.name, Rect = r.rect,
                        Message = $"'{r.name}' extends past the texture (rect {RectStr(r.rect)} vs texture {W}x{H}). Content past the edge is invisible.",
                    });
                }
            }
        }

        static void CheckDuplicateNames(SpriteRect[] rects, Report report)
        {
            var groups = rects.GroupBy(r => r.name).Where(g => g.Count() > 1);
            foreach (var g in groups)
            {
                report.Warnings.Add(new Warning {
                    Kind = "duplicate_name", Severity = "error",
                    RectName = g.Key,
                    Message = $"'{g.Key}' is used by {g.Count()} rects — sprite-by-name lookups are ambiguous. Rename via slice-sprite --mode rects with unique names.",
                    Detail = new Dictionary<string, object> { ["count"] = g.Count() },
                });
            }
        }

        static void CheckTinyRects(SpriteRect[] rects, Report report)
        {
            foreach (var r in rects)
            {
                if (r.rect.width < TinyRectThreshold || r.rect.height < TinyRectThreshold)
                {
                    report.Warnings.Add(new Warning {
                        Kind = "tiny_rect", Severity = "info",
                        RectName = r.name, Rect = r.rect,
                        Message = $"'{r.name}' is {(int)r.rect.width}x{(int)r.rect.height} — below {TinyRectThreshold}px on a side. Likely accidental from too-low --min-size during auto-slice.",
                    });
                }
            }
        }

        static void CheckOverlaps(SpriteRect[] rects, Report report)
        {
            for (int i = 0; i < rects.Length; i++)
            {
                for (int j = i + 1; j < rects.Length; j++)
                {
                    if (rects[i].rect.Overlaps(rects[j].rect))
                    {
                        var inter = Intersect(rects[i].rect, rects[j].rect);
                        report.Warnings.Add(new Warning {
                            Kind = "overlap", Severity = "info",
                            Message = $"'{rects[i].name}' and '{rects[j].name}' overlap on {(int)inter.width}x{(int)inter.height} pixels. Intentional for merge-bbox composites; flag if not.",
                            Detail = new Dictionary<string, object> {
                                ["a"] = rects[i].name, ["b"] = rects[j].name,
                                ["intersection"] = $"{(int)inter.x},{(int)inter.y},{(int)inter.width}x{(int)inter.height}",
                            },
                        });
                    }
                }
            }
        }

        // ─── pixel-content checks ─────────────────────────────────────────

        static void CheckEmptyAndLowDensity(SpriteRect[] rects, Color[] pixels, int W, int H, Report report)
        {
            foreach (var r in rects)
            {
                int total = 0, opaque = 0;
                IterateRect(r.rect, W, H, (x, y) => {
                    total++;
                    if (pixels[y * W + x].a > 0.01f) opaque++;
                });
                if (total == 0) continue;
                if (opaque == 0)
                {
                    report.Warnings.Add(new Warning {
                        Kind = "empty_rect", Severity = "warn",
                        RectName = r.name, Rect = r.rect,
                        Message = $"'{r.name}' is fully transparent — likely a stale rect after the source art was removed. Consider deleting or re-slicing.",
                    });
                }
                else if ((float)opaque / total < LowDensityThreshold)
                {
                    report.Warnings.Add(new Warning {
                        Kind = "low_density", Severity = "info",
                        RectName = r.name, Rect = r.rect,
                        Message = $"'{r.name}' is {(100f * opaque / total):F1}% opaque — mostly empty bbox. The rect may be larger than the actual sprite content.",
                        Detail = new Dictionary<string, object> { ["opaqueRatio"] = (float)opaque / total },
                    });
                }
            }
        }

        // Boundary clip: a rect cuts through art when an inside-edge pixel is opaque AND its
        // neighbour just outside the rect is also opaque. We check all four edges per rect.
        static void CheckPartiallyClipped(SpriteRect[] rects, Color[] pixels, int W, int H, Report report)
        {
            foreach (var r in rects)
            {
                var clipped = new List<string>();
                if (HasClipOnEdge(pixels, W, H, r.rect, "left"))   clipped.Add("left");
                if (HasClipOnEdge(pixels, W, H, r.rect, "right"))  clipped.Add("right");
                if (HasClipOnEdge(pixels, W, H, r.rect, "top"))    clipped.Add("top");
                if (HasClipOnEdge(pixels, W, H, r.rect, "bottom")) clipped.Add("bottom");
                if (clipped.Count > 0)
                {
                    report.Warnings.Add(new Warning {
                        Kind = "partially_clipped", Severity = "warn",
                        RectName = r.name, Rect = r.rect,
                        Message = $"'{r.name}' rect cuts through opaque content on edges: {string.Join(", ", clipped)}. The sprite may extend past the rect — widen via slice-sprite --mode rects.",
                        Detail = new Dictionary<string, object> { ["edges"] = clipped },
                    });
                }
            }
        }

        static bool HasClipOnEdge(Color[] pixels, int W, int H, Rect r, string edge)
        {
            int x0 = Mathf.Clamp((int)r.x, 0, W - 1);
            int y0 = Mathf.Clamp((int)r.y, 0, H - 1);
            int x1 = Mathf.Clamp((int)r.xMax - 1, 0, W - 1);
            int y1 = Mathf.Clamp((int)r.yMax - 1, 0, H - 1);

            switch (edge)
            {
                case "left":   return x0 > 0     && AnyEdgePair(pixels, W, x0, x0 - 1, y0, y1, vertical: true);
                case "right":  return x1 < W - 1 && AnyEdgePair(pixels, W, x1, x1 + 1, y0, y1, vertical: true);
                case "bottom": return y0 > 0     && AnyEdgePair(pixels, W, y0, y0 - 1, x0, x1, vertical: false);
                case "top":    return y1 < H - 1 && AnyEdgePair(pixels, W, y1, y1 + 1, x0, x1, vertical: false);
            }
            return false;
        }

        static bool AnyEdgePair(Color[] pixels, int W, int inside, int outside, int rangeStart, int rangeEnd, bool vertical)
        {
            for (int p = rangeStart; p <= rangeEnd; p++)
            {
                int idxIn  = vertical ? p * W + inside  : inside  * W + p;
                int idxOut = vertical ? p * W + outside : outside * W + p;
                if (pixels[idxIn].a > 0.5f && pixels[idxOut].a > 0.5f) return true;
            }
            return false;
        }

        // Connected components of opaque-but-uncovered pixels. Iterative flood-fill (stack)
        // so deep components don't blow the call stack on big sheets.
        static void CheckOrphanPixels(SpriteRect[] rects, Color[] pixels, int W, int H, Report report)
        {
            bool[] inAnyRect = new bool[W * H];
            foreach (var r in rects) IterateRect(r.rect, W, H, (x, y) => inAnyRect[y * W + x] = true);

            bool[] visited = new bool[W * H];
            for (int y = 0; y < H; y++)
            {
                for (int x = 0; x < W; x++)
                {
                    int idx = y * W + x;
                    if (visited[idx]) continue;
                    if (inAnyRect[idx]) { visited[idx] = true; continue; }
                    if (pixels[idx].a < 0.5f) { visited[idx] = true; continue; }

                    var island = FloodFill(pixels, inAnyRect, visited, W, H, x, y);
                    if (island.PixelCount >= OrphanMinPixels)
                    {
                        report.Warnings.Add(new Warning {
                            Kind = "orphan_pixels", Severity = "warn",
                            Rect = island.Bounds,
                            Message = $"Uncovered art at {RectStr(island.Bounds)} ({island.PixelCount} opaque pixels) — content is outside every sprite rect. Consider slice-sprite --mode auto or extend-sprite to capture it.",
                            Detail = new Dictionary<string, object> { ["pixelCount"] = island.PixelCount },
                        });
                    }
                }
            }
        }

        struct Island { public Rect Bounds; public int PixelCount; }

        static Island FloodFill(Color[] pixels, bool[] inAnyRect, bool[] visited, int W, int H, int sx, int sy)
        {
            int xMin = sx, yMin = sy, xMax = sx, yMax = sy, count = 0;
            var stack = new Stack<int>();
            stack.Push(sy * W + sx);
            while (stack.Count > 0)
            {
                int idx = stack.Pop();
                if (visited[idx]) continue;
                visited[idx] = true;
                if (inAnyRect[idx]) continue;
                if (pixels[idx].a < 0.5f) continue;
                count++;
                int x = idx % W;
                int y = idx / W;
                if (x < xMin) xMin = x;
                if (x > xMax) xMax = x;
                if (y < yMin) yMin = y;
                if (y > yMax) yMax = y;
                if (x > 0)     stack.Push(idx - 1);
                if (x < W - 1) stack.Push(idx + 1);
                if (y > 0)     stack.Push(idx - W);
                if (y < H - 1) stack.Push(idx + W);
            }
            return new Island {
                Bounds = new Rect(xMin, yMin, xMax - xMin + 1, yMax - yMin + 1),
                PixelCount = count,
            };
        }

        // ─── helpers ──────────────────────────────────────────────────────

        static Rect Intersect(Rect a, Rect b)
        {
            float x0 = Mathf.Max(a.xMin, b.xMin);
            float y0 = Mathf.Max(a.yMin, b.yMin);
            float x1 = Mathf.Min(a.xMax, b.xMax);
            float y1 = Mathf.Min(a.yMax, b.yMax);
            return new Rect(x0, y0, Mathf.Max(0, x1 - x0), Mathf.Max(0, y1 - y0));
        }

        static void IterateRect(Rect r, int W, int H, Action<int, int> visit)
        {
            int x0 = Mathf.Clamp((int)r.x, 0, W);
            int y0 = Mathf.Clamp((int)r.y, 0, H);
            int x1 = Mathf.Clamp((int)r.xMax, 0, W);
            int y1 = Mathf.Clamp((int)r.yMax, 0, H);
            for (int y = y0; y < y1; y++)
                for (int x = x0; x < x1; x++)
                    visit(x, y);
        }

        static string RectStr(Rect r) => $"({(int)r.x},{(int)r.y},{(int)r.width}x{(int)r.height})";

        // ─── JSON serialization for command results ───────────────────────

        public static JsonBuilder BuildJson(Report report)
        {
            var byKind = report.CountByKind;
            string summary;
            if (report.Warnings.Count == 0)
            {
                summary = "ok — no issues detected.";
            }
            else
            {
                var counts = byKind.Select(kv => $"{kv.Value} {kv.Key}").ToArray();
                summary = $"{report.Warnings.Count} issue{(report.Warnings.Count == 1 ? "" : "s")}: {string.Join(", ", counts)}.";
            }

            var warningsArr = SimpleJson.Array();
            foreach (var w in report.Warnings)
            {
                var obj = SimpleJson.Object()
                    .Put("kind", w.Kind)
                    .Put("severity", w.Severity)
                    .Put("message", w.Message);
                if (!string.IsNullOrEmpty(w.RectName)) obj.Put("rect", w.RectName);
                if (w.Rect.HasValue) obj.Put("bounds", RectStr(w.Rect.Value));
                if (w.Detail != null && w.Detail.Count > 0)
                {
                    var d = SimpleJson.Object();
                    foreach (var kv in w.Detail)
                    {
                        switch (kv.Value)
                        {
                            case string s: d.Put(kv.Key, s); break;
                            case int ii:   d.Put(kv.Key, ii); break;
                            case long ll:  d.Put(kv.Key, ll); break;
                            case float ff: d.Put(kv.Key, ff); break;
                            case double dd: d.Put(kv.Key, dd); break;
                            case bool bb:  d.Put(kv.Key, bb); break;
                            case List<string> ls: d.Put(kv.Key, ls.ToArray()); break;
                            default:       d.Put(kv.Key, kv.Value?.ToString() ?? "null"); break;
                        }
                    }
                    obj.PutRaw("detail", d.ToString());
                }
                warningsArr.AddRaw(obj.ToString());
            }

            return SimpleJson.Object()
                .Put("ok", report.Ok)
                .Put("summary", summary)
                .Put("count", report.Warnings.Count)
                .PutRaw("warnings", warningsArr.ToString());
        }
    }
}
