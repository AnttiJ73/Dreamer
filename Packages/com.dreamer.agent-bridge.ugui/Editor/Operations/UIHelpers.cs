using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Reflection;
using UnityEditor;
using UnityEngine;
using UnityEngine.UI;

namespace Dreamer.AgentBridge
{
    /// <summary>Shared helpers for the UI operation commands.</summary>
    public static class UIHelpers
    {
        // ── Anchor presets ──────────────────────────────────────────────

        /// <summary>Resolved anchor spec: min/max anchor + pivot, with per-axis stretch flags.</summary>
        public struct AnchorSpec
        {
            public Vector2 anchorMin;
            public Vector2 anchorMax;
            public Vector2 pivot;
            public bool stretchX;
            public bool stretchY;
        }

        /// <summary>Parse a named anchor preset (e.g. "center", "top-stretch", "fill"); separators dash/underscore/space, case-insensitive.</summary>
        public static bool TryParseAnchor(string name, out AnchorSpec spec)
        {
            spec = default;
            if (string.IsNullOrEmpty(name)) return false;

            string key = name.Trim().ToLowerInvariant().Replace('_', '-').Replace(' ', '-');

            switch (key)
            {
                // Simple 9-point grid (non-stretched)
                case "top-left":      spec = MakeAnchor(0, 1, 0, 1); return true;
                case "top":
                case "top-center":    spec = MakeAnchor(0.5f, 1, 0.5f, 1); return true;
                case "top-right":     spec = MakeAnchor(1, 1, 1, 1); return true;

                case "middle-left":
                case "left":          spec = MakeAnchor(0, 0.5f, 0, 0.5f); return true;
                case "center":
                case "middle":
                case "middle-center": spec = MakeAnchor(0.5f, 0.5f, 0.5f, 0.5f); return true;
                case "middle-right":
                case "right":         spec = MakeAnchor(1, 0.5f, 1, 0.5f); return true;

                case "bottom-left":   spec = MakeAnchor(0, 0, 0, 0); return true;
                case "bottom":
                case "bottom-center": spec = MakeAnchor(0.5f, 0, 0.5f, 0); return true;
                case "bottom-right":  spec = MakeAnchor(1, 0, 1, 0); return true;

                // Stretched (horizontal stretch)
                case "top-stretch":    spec = MakeStretchH(1); return true;
                case "middle-stretch":
                case "center-stretch": spec = MakeStretchH(0.5f); return true;
                case "bottom-stretch": spec = MakeStretchH(0); return true;

                // Stretched (vertical stretch)
                case "stretch-left":   spec = MakeStretchV(0); return true;
                case "stretch-center":
                case "stretch-middle": spec = MakeStretchV(0.5f); return true;
                case "stretch-right":  spec = MakeStretchV(1); return true;

                // Full stretch
                case "fill":
                case "stretch":
                case "stretch-stretch":
                case "fill-parent":    spec = MakeFill(); return true;

                default: return false;
            }
        }

        /// <summary>Enumerate all accepted anchor preset names (for error messages).</summary>
        public static string[] AnchorPresetNames() => new[]
        {
            "top-left", "top", "top-right",
            "left", "center", "right",
            "bottom-left", "bottom", "bottom-right",
            "top-stretch", "middle-stretch", "bottom-stretch",
            "stretch-left", "stretch-center", "stretch-right",
            "fill",
        };

        static AnchorSpec MakeAnchor(float aMinX, float aMinY, float aMaxX, float aMaxY)
        {
            // Pivot mirrors the anchor location — matches Unity Inspector's Alt+anchor-preset behavior.
            return new AnchorSpec
            {
                anchorMin = new Vector2(aMinX, aMinY),
                anchorMax = new Vector2(aMaxX, aMaxY),
                pivot = new Vector2((aMinX + aMaxX) * 0.5f, (aMinY + aMaxY) * 0.5f),
                stretchX = false,
                stretchY = false,
            };
        }

        static AnchorSpec MakeStretchH(float y)
        {
            return new AnchorSpec
            {
                anchorMin = new Vector2(0, y),
                anchorMax = new Vector2(1, y),
                pivot = new Vector2(0.5f, y),
                stretchX = true,
                stretchY = false,
            };
        }

        static AnchorSpec MakeStretchV(float x)
        {
            return new AnchorSpec
            {
                anchorMin = new Vector2(x, 0),
                anchorMax = new Vector2(x, 1),
                pivot = new Vector2(x, 0.5f),
                stretchX = false,
                stretchY = true,
            };
        }

        static AnchorSpec MakeFill()
        {
            return new AnchorSpec
            {
                anchorMin = Vector2.zero,
                anchorMax = Vector2.one,
                pivot = new Vector2(0.5f, 0.5f),
                stretchX = true,
                stretchY = true,
            };
        }

        // ── RectTransform configuration ─────────────────────────────────

        /// <summary>Apply an anchor preset + size + optional pivot/offset overrides; see UNITY-LAYOUT-QUIRKS.md for sizeDelta/offset semantics.</summary>
        public static void ApplyRectTransform(
            RectTransform rt,
            AnchorSpec anchor,
            Vector2? size,
            Vector2? pivotOverride,
            Vector2? anchoredPosition,
            Vector2? offsetMin,
            Vector2? offsetMax)
        {
            rt.anchorMin = anchor.anchorMin;
            rt.anchorMax = anchor.anchorMax;
            rt.pivot = pivotOverride ?? anchor.pivot;

            // Per-axis sizeDelta: stretched axes default to 0 (fill exactly), non-stretched
            // axes take the literal size. Always recompute, even when `size` is null, so
            // Unity's (100,100) RectTransform default doesn't leak into a "fill"-anchored panel.
            Vector2 sd = rt.sizeDelta;
            if (anchor.stretchX) sd.x = size.HasValue ? size.Value.x : 0;
            else if (size.HasValue) sd.x = size.Value.x;
            if (anchor.stretchY) sd.y = size.HasValue ? size.Value.y : 0;
            else if (size.HasValue) sd.y = size.Value.y;
            rt.sizeDelta = sd;

            if (anchoredPosition.HasValue) rt.anchoredPosition = anchoredPosition.Value;

            // Per-axis offset application — only on stretched axes. On non-stretched axes
            // the offsets are derived from sizeDelta + pivot; overwriting them would corrupt
            // the panel size. Common bug: side-anchored vertically-stretched panel with
            // `offsetMin: [0, 100]` zeroing the width because the x component clobbered
            // the -sizeDelta.x*pivot.x derived value.
            if (offsetMin.HasValue || offsetMax.HasValue)
            {
                Vector2 newMin = rt.offsetMin;
                Vector2 newMax = rt.offsetMax;
                if (offsetMin.HasValue)
                {
                    if (anchor.stretchX) newMin.x = offsetMin.Value.x;
                    if (anchor.stretchY) newMin.y = offsetMin.Value.y;
                }
                if (offsetMax.HasValue)
                {
                    if (anchor.stretchX) newMax.x = offsetMax.Value.x;
                    if (anchor.stretchY) newMax.y = offsetMax.Value.y;
                }
                rt.offsetMin = newMin;
                rt.offsetMax = newMax;
            }
        }

        // ── Value parsing (shared JSON helpers) ─────────────────────────

        /// <summary>Parse a size like [w,h] or "WxH" or {"w":N,"h":N}.</summary>
        public static bool TryParseSize(object raw, out Vector2 size)
        {
            size = Vector2.zero;
            if (raw == null) return false;
            if (raw is List<object> list && list.Count == 2)
            {
                size = new Vector2(ToFloat(list[0]), ToFloat(list[1]));
                return true;
            }
            if (raw is Dictionary<string, object> dict)
            {
                float x = TryGetFloat(dict, "x", TryGetFloat(dict, "w", TryGetFloat(dict, "width", float.NaN)));
                float y = TryGetFloat(dict, "y", TryGetFloat(dict, "h", TryGetFloat(dict, "height", float.NaN)));
                if (!float.IsNaN(x) && !float.IsNaN(y)) { size = new Vector2(x, y); return true; }
            }
            if (raw is string str)
            {
                // "WxH" or "W,H"
                var parts = str.Split(new[] { 'x', 'X', ',' }, 2);
                if (parts.Length == 2
                    && float.TryParse(parts[0], NumberStyles.Float, CultureInfo.InvariantCulture, out float w)
                    && float.TryParse(parts[1], NumberStyles.Float, CultureInfo.InvariantCulture, out float h))
                {
                    size = new Vector2(w, h);
                    return true;
                }
            }
            return false;
        }

        /// <summary>Parse a 2-component vector like [x,y] or {"x":N,"y":N} or "X,Y".</summary>
        public static bool TryParseVector2(object raw, out Vector2 v)
        {
            v = Vector2.zero;
            if (raw == null) return false;
            if (raw is List<object> list && list.Count == 2)
            {
                v = new Vector2(ToFloat(list[0]), ToFloat(list[1]));
                return true;
            }
            if (raw is Dictionary<string, object> dict
                && dict.ContainsKey("x") && dict.ContainsKey("y"))
            {
                v = new Vector2(ToFloat(dict["x"]), ToFloat(dict["y"]));
                return true;
            }
            if (raw is string str)
            {
                var parts = str.Split(',');
                if (parts.Length == 2
                    && float.TryParse(parts[0], NumberStyles.Float, CultureInfo.InvariantCulture, out float x)
                    && float.TryParse(parts[1], NumberStyles.Float, CultureInfo.InvariantCulture, out float y))
                {
                    v = new Vector2(x, y);
                    return true;
                }
            }
            return false;
        }

        /// <summary>
        /// Parse a color. Accepts {r,g,b,a} dicts (0–1 floats), "#rrggbb" / "#rrggbbaa"
        /// hex strings, or common named colors.
        /// </summary>
        public static bool TryParseColor(object raw, out Color color)
        {
            color = Color.white;
            if (raw == null) return false;
            if (raw is Dictionary<string, object> dict)
            {
                color = new Color(
                    TryGetFloat(dict, "r", 0f), TryGetFloat(dict, "g", 0f),
                    TryGetFloat(dict, "b", 0f), TryGetFloat(dict, "a", 1f));
                return true;
            }
            if (raw is string str)
            {
                if (str.StartsWith("#") && (str.Length == 7 || str.Length == 9))
                {
                    try
                    {
                        int r = Convert.ToInt32(str.Substring(1, 2), 16);
                        int g = Convert.ToInt32(str.Substring(3, 2), 16);
                        int b = Convert.ToInt32(str.Substring(5, 2), 16);
                        int a = str.Length == 9 ? Convert.ToInt32(str.Substring(7, 2), 16) : 255;
                        color = new Color(r / 255f, g / 255f, b / 255f, a / 255f);
                        return true;
                    }
                    catch { return false; }
                }
                switch (str.Trim().ToLowerInvariant())
                {
                    case "white":   color = Color.white;   return true;
                    case "black":   color = Color.black;   return true;
                    case "red":     color = Color.red;     return true;
                    case "green":   color = Color.green;   return true;
                    case "blue":    color = Color.blue;    return true;
                    case "yellow":  color = Color.yellow;  return true;
                    case "cyan":    color = Color.cyan;    return true;
                    case "magenta": color = Color.magenta; return true;
                    case "gray":
                    case "grey":    color = Color.gray;    return true;
                    case "clear":
                    case "transparent": color = Color.clear; return true;
                }
            }
            return false;
        }

        static float ToFloat(object v) => ToFloatSafe(v, 0f);

        /// <summary>Coerce a JSON-parsed value into a float; accepts numeric types or numeric strings, returns fallback otherwise.</summary>
        public static float ToFloatSafe(object v, float fallback = 0f)
        {
            if (v == null) return fallback;
            if (v is double d) return (float)d;
            if (v is float f) return f;
            if (v is int i) return i;
            if (v is long l) return l;
            if (v is string s && float.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out float parsed)) return parsed;
            return fallback;
        }

        static float TryGetFloat(Dictionary<string, object> dict, string key, float fallback)
        {
            return dict.TryGetValue(key, out object v) ? ToFloat(v) : fallback;
        }

        // ── TextMeshPro detection + text setup ──────────────────────────

        static bool _tmpResolved;
        static Type _tmpType;      // TMPro.TextMeshProUGUI
        static Type _tmpAlignType; // TMPro.TextAlignmentOptions

        /// <summary>Resolve the TMP component type via reflection; null if TMP isn't installed (caller falls back to legacy Text).</summary>
        public static Type ResolveTMPType()
        {
            if (_tmpResolved) return _tmpType;
            _tmpResolved = true;
            foreach (var asm in AppDomain.CurrentDomain.GetAssemblies())
            {
                try
                {
                    var t = asm.GetType("TMPro.TextMeshProUGUI", throwOnError: false);
                    if (t != null) { _tmpType = t; break; }
                }
                catch { /* skip assemblies that refuse GetType */ }
            }
            foreach (var asm in AppDomain.CurrentDomain.GetAssemblies())
            {
                try
                {
                    var t = asm.GetType("TMPro.TextAlignmentOptions", throwOnError: false);
                    if (t != null) { _tmpAlignType = t; break; }
                }
                catch { }
            }
            return _tmpType;
        }

        /// <summary>Add a text component (TMP if available, legacy Text otherwise) to go; wasTmp signals which path was taken.</summary>
        public static Component AddTextComponent(GameObject go, string text, float fontSize, Color? color, string alignment, out bool wasTmp)
        {
            var tmpType = ResolveTMPType();
            if (tmpType != null)
            {
                var comp = go.AddComponent(tmpType);
                SetReflectedProp(comp, "text", text ?? "");
                if (fontSize > 0) SetReflectedProp(comp, "fontSize", fontSize);
                if (color.HasValue) SetReflectedProp(comp, "color", color.Value);
                ApplyTMPAlignment(comp, alignment);
                wasTmp = true;
                return comp;
            }

            var legacy = go.AddComponent<Text>();
            legacy.text = text ?? "";
            if (fontSize > 0) legacy.fontSize = Mathf.RoundToInt(fontSize);
            if (color.HasValue) legacy.color = color.Value;
            legacy.alignment = ParseLegacyAlignment(alignment);
            legacy.horizontalOverflow = HorizontalWrapMode.Wrap;
            legacy.verticalOverflow = VerticalWrapMode.Truncate;
            // Legacy Text needs a Font; LegacyRuntime is the Unity-shipped default in the
            // built-in resources; missing means the user hasn't imported it and text will
            // be invisible. Fall back silently — caller can swap to TMP later.
            legacy.font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf")
                ?? Resources.GetBuiltinResource<Font>("Arial.ttf");
            wasTmp = false;
            return legacy;
        }

        static void SetReflectedProp(object target, string name, object value)
        {
            if (target == null) return;
            var t = target.GetType();
            var p = t.GetProperty(name, BindingFlags.Public | BindingFlags.Instance);
            if (p != null && p.CanWrite)
            {
                try { p.SetValue(target, value); return; } catch { /* try field */ }
            }
            var f = t.GetField(name, BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance);
            if (f != null)
            {
                try { f.SetValue(target, value); } catch { /* best-effort */ }
            }
        }

        static void ApplyTMPAlignment(Component tmpComp, string alignment)
        {
            if (tmpComp == null || _tmpAlignType == null || string.IsNullOrEmpty(alignment)) return;
            int val = TMPAlignmentValue(alignment);
            if (val < 0) return;
            var p = tmpComp.GetType().GetProperty("alignment", BindingFlags.Public | BindingFlags.Instance);
            if (p != null && p.CanWrite)
            {
                try
                {
                    var enumVal = Enum.ToObject(_tmpAlignType, val);
                    p.SetValue(tmpComp, enumVal);
                }
                catch { /* best-effort */ }
            }
        }

        // Pre-resolved TMP TextAlignmentOptions values by name (from the TMP source).
        // Hard-coded so we don't depend on Enum.Parse which needs the typed reference.
        static int TMPAlignmentValue(string name)
        {
            // Normalized form: lowercase, '-' and '_' replaced with space.
            // Both "middle-left" and "middle left" map to the same normalized
            // form, and both point at TMP's Left (513 = Middle|Left). Earlier
            // versions missed the explicit "middle left" cases and fell through
            // to default → alignment not applied → TMP defaulted to TopLeft,
            // which visually stuffs text into the top-left corner of tall rows
            // (e.g. a 14px label in a 32px row) and reads as "label size wrong".
            switch (name.Trim().ToLowerInvariant().Replace('_', ' ').Replace('-', ' '))
            {
                case "top left":      return 257;   // TopLeft  = Top | Left
                case "top":
                case "top center":    return 258;   // Top      = Top | Center
                case "top right":     return 260;   // TopRight = Top | Right
                case "left":
                case "middle left":   return 513;   // Left     = Middle | Left
                case "center":
                case "middle":
                case "middle center": return 514;   // Center   = Middle | Center
                case "right":
                case "middle right":  return 516;   // Right    = Middle | Right
                case "bottom left":   return 1025;  // BottomLeft  = Bottom | Left
                case "bottom":
                case "bottom center": return 1026;
                case "bottom right":  return 1028;
                case "justified":     return 4098;
                default: return -1;
            }
        }

        static TextAnchor ParseLegacyAlignment(string name)
        {
            if (string.IsNullOrEmpty(name)) return TextAnchor.MiddleCenter;
            switch (name.Trim().ToLowerInvariant().Replace('_', '-').Replace(' ', '-'))
            {
                case "top-left":      return TextAnchor.UpperLeft;
                case "top":
                case "top-center":    return TextAnchor.UpperCenter;
                case "top-right":     return TextAnchor.UpperRight;
                case "left":          return TextAnchor.MiddleLeft;
                case "center":
                case "middle":
                case "middle-center": return TextAnchor.MiddleCenter;
                case "right":         return TextAnchor.MiddleRight;
                case "bottom-left":   return TextAnchor.LowerLeft;
                case "bottom":
                case "bottom-center": return TextAnchor.LowerCenter;
                case "bottom-right":  return TextAnchor.LowerRight;
                default:              return TextAnchor.MiddleCenter;
            }
        }

        // ── EventSystem ensurance ───────────────────────────────────────

        /// <summary>Ensure scene has an EventSystem (required for Button/Toggle/Slider clicks); picks the input module matching project's active Input handling.</summary>
        // Mismatched input module vs project setting throws at runtime ("trying to read Input using
        // UnityEngine.Input class, but you have switched to Input System package") — hence the explicit detection.
        public static bool EnsureEventSystem()
        {
#if UNITY_2023_1_OR_NEWER
            var existing = UnityEngine.Object.FindFirstObjectByType<UnityEngine.EventSystems.EventSystem>(FindObjectsInactive.Include);
#else
            var existing = UnityEngine.Object.FindObjectOfType<UnityEngine.EventSystems.EventSystem>(true);
#endif
            if (existing != null) return false;

            var go = new GameObject("EventSystem", typeof(UnityEngine.EventSystems.EventSystem));
            Undo.RegisterCreatedObjectUndo(go, "Create EventSystem");

            System.Type moduleType = null;
#if ENABLE_INPUT_SYSTEM
            foreach (var asm in System.AppDomain.CurrentDomain.GetAssemblies())
            {
                System.Type t = null;
                try { t = asm.GetType("UnityEngine.InputSystem.UI.InputSystemUIInputModule", false); }
                catch { /* assembly may not load — skip */ }
                if (t != null) { moduleType = t; break; }
            }
#endif
            if (moduleType == null) moduleType = typeof(UnityEngine.EventSystems.StandaloneInputModule);
            go.AddComponent(moduleType);
            return true;
        }

        // ── Scene-vs-prefab target resolver ─────────────────────────────

        /// <summary>Resolve a parent GameObject from `parent`/`parentPath`/`sceneObjectPath` args; null = scene root.</summary>
        public static GameObject ResolveParent(Dictionary<string, object> args, out string error)
        {
            error = null;
            string path = SimpleJson.GetString(args, "parent")
                ?? SimpleJson.GetString(args, "parentPath")
                ?? SimpleJson.GetString(args, "sceneObjectPath");
            if (string.IsNullOrEmpty(path)) return null;
            var go = PropertyOps.FindSceneObject(path, out error);
            return go;
        }

        /// <summary>Ensure the RectTransform is added (Canvas children need one).</summary>
        public static RectTransform EnsureRectTransform(GameObject go)
        {
            var rt = go.GetComponent<RectTransform>();
            if (rt == null) rt = go.AddComponent<RectTransform>();
            return rt;
        }

        /// <summary>Apply anchor/size/pivot args to an already-placed UI GO.</summary>
        public static string ApplyRectTransformArgs(RectTransform rt, Dictionary<string, object> args)
        {
            string anchorName = SimpleJson.GetString(args, "anchor");
            AnchorSpec spec = default;
            bool hasAnchor = !string.IsNullOrEmpty(anchorName);
            if (hasAnchor && !TryParseAnchor(anchorName, out spec))
                return $"Unknown anchor preset '{anchorName}'. Valid: {string.Join(", ", AnchorPresetNames())}.";
            if (!hasAnchor)
            {
                spec.anchorMin = rt.anchorMin;
                spec.anchorMax = rt.anchorMax;
                spec.pivot = rt.pivot;
                spec.stretchX = rt.anchorMin.x != rt.anchorMax.x;
                spec.stretchY = rt.anchorMin.y != rt.anchorMax.y;
            }

            Vector2? size = null;
            if (args.TryGetValue("size", out object sizeRaw))
            {
                if (TryParseSize(sizeRaw, out Vector2 s)) size = s;
                else return "`size` must be [w,h], \"WxH\", or {\"w\":N,\"h\":N}.";
            }

            Vector2? pivot = null;
            if (args.TryGetValue("pivot", out object pivotRaw))
            {
                if (TryParseVector2(pivotRaw, out Vector2 p)) pivot = p;
                else return "`pivot` must be [x,y], \"X,Y\", or {\"x\":N,\"y\":N}.";
            }

            Vector2? pos = null;
            if (args.TryGetValue("anchoredPosition", out object posRaw)
                || args.TryGetValue("offset", out posRaw))
            {
                if (TryParseVector2(posRaw, out Vector2 p)) pos = p;
                else return "`anchoredPosition` / `offset` must be [x,y], \"X,Y\", or {\"x\":N,\"y\":N}.";
            }

            Vector2? oMin = null;
            if (args.TryGetValue("offsetMin", out object minRaw))
            {
                if (TryParseVector2(minRaw, out Vector2 p)) oMin = p;
                else return "`offsetMin` must be [x,y].";
            }
            Vector2? oMax = null;
            if (args.TryGetValue("offsetMax", out object maxRaw))
            {
                if (TryParseVector2(maxRaw, out Vector2 p)) oMax = p;
                else return "`offsetMax` must be [x,y].";
            }

            // `margin` shortcut: CSS-style insets translated to offsetMin/Max for stretched axes.
            // Explicit offsetMin/Max wins if both are present.
            if (args.TryGetValue("margin", out object marginRaw))
            {
                if (!TryParseMargin(marginRaw, out float mTop, out float mRight, out float mBot, out float mLeft))
                    return "`margin` must be N (uniform), [top, right, bottom, left], or {\"top\":N,\"right\":N,\"bottom\":N,\"left\":N}.";
                if (!oMin.HasValue) oMin = new Vector2(mLeft, mBot);
                if (!oMax.HasValue) oMax = new Vector2(-mRight, -mTop);
            }

            ApplyRectTransform(rt, spec, size, pivot, pos, oMin, oMax);
            return null;
        }

        /// <summary>Parse `margin`: uniform N, [top, right, bottom, left], or per-side dict — all positive insets.</summary>
        public static bool TryParseMargin(object raw, out float top, out float right, out float bottom, out float left)
        {
            top = right = bottom = left = 0f;
            if (raw == null) return false;
            if (raw is List<object> list)
            {
                if (list.Count == 1)
                {
                    float v = ToFloat(list[0]);
                    top = right = bottom = left = v;
                    return true;
                }
                if (list.Count == 4)
                {
                    top    = ToFloat(list[0]);
                    right  = ToFloat(list[1]);
                    bottom = ToFloat(list[2]);
                    left   = ToFloat(list[3]);
                    return true;
                }
                return false;
            }
            if (raw is Dictionary<string, object> dict)
            {
                top    = TryGetFloat(dict, "top",    0f);
                right  = TryGetFloat(dict, "right",  0f);
                bottom = TryGetFloat(dict, "bottom", 0f);
                left   = TryGetFloat(dict, "left",   0f);
                return true;
            }
            float u = ToFloat(raw);
            top = right = bottom = left = u;
            return true;
        }

        /// <summary>Cast object to Dictionary or return null.</summary>
        public static Dictionary<string, object> AsDict(object o) => o as Dictionary<string, object>;
    }
}
