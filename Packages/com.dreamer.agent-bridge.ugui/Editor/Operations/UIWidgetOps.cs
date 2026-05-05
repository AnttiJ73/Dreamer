using System;
using System.Collections.Generic;
using UnityEditor;
using UnityEngine;
using UnityEngine.UI;
using Object = UnityEngine.Object;
#if DREAMER_HAS_TMP
using TMPro;
#endif

namespace Dreamer.AgentBridge
{
    /// <summary>One command per common Canvas UI widget; each builds the full composite structure with sensible defaults.</summary>
    public static class UIWidgetOps
    {
        // ────────────────────────────────────────────────────────────────
        //  Common entry helpers
        // ────────────────────────────────────────────────────────────────

        /// <summary>Resolve parent Transform for a new UI element; null = scene root.</summary>
        static Transform ResolveParent(Dictionary<string, object> args, out string error)
        {
            error = null;
            // _parentInstanceId is UITreeOps' private channel — avoids path ambiguity when siblings share names.
            if (args.TryGetValue("_parentInstanceId", out object idRaw))
            {
                int id = (int)UIHelpers.ToFloatSafe(idRaw);
                if (id != 0)
                {
                    var obj = UnityEditor.EditorUtility.InstanceIDToObject(id);
                    if (obj is GameObject igo) return igo.transform;
                    if (obj is Component ic) return ic.transform;
                }
            }
            string path = SimpleJson.GetString(args, "parent")
                ?? SimpleJson.GetString(args, "parentPath");
            if (string.IsNullOrEmpty(path)) return null;
            var go = PropertyOps.FindSceneObject(path, out error);
            return go != null ? go.transform : null;
        }

        /// <summary>Finalize a new UI GO: apply rect args, register undo, set dirty.</summary>
        static string FinalizeUI(GameObject go, Dictionary<string, object> args, string undoLabel)
        {
            var rt = UIHelpers.EnsureRectTransform(go);
            string err = UIHelpers.ApplyRectTransformArgs(rt, args);
            if (err != null)
            {
                Object.DestroyImmediate(go);
                return err;
            }
            Undo.RegisterCreatedObjectUndo(go, undoLabel);
            EditorUtility.SetDirty(go);
            return null;
        }

        static CommandResult ResultFor(GameObject go, string extraKey = null, object extraVal = null)
        {
            var json = SimpleJson.Object()
                .Put("created", true)
                .Put("name", go.name)
                .Put("path", PropertyOps.GetScenePath(go))
                .Put("instanceId", go.GetInstanceID());
            if (!string.IsNullOrEmpty(extraKey))
            {
                if (extraVal is bool b) json.Put(extraKey, b);
                else if (extraVal is string s) json.Put(extraKey, s);
                else if (extraVal is int i) json.Put(extraKey, i);
                else if (extraVal is float f) json.Put(extraKey, f);
            }
            return CommandResult.Ok(json.ToString());
        }

        // ────────────────────────────────────────────────────────────────
        //  create_ui_canvas
        //  Args: { name?, renderMode?, referenceResolution?: [w,h], sortOrder? }
        // ────────────────────────────────────────────────────────────────
        public static CommandResult CreateCanvas(Dictionary<string, object> args)
        {
            string name = SimpleJson.GetString(args, "name", "Canvas");
            string renderModeStr = SimpleJson.GetString(args, "renderMode", "overlay");

            RenderMode mode;
            switch (renderModeStr.Trim().ToLowerInvariant().Replace('_', '-').Replace(' ', '-'))
            {
                case "overlay":
                case "screen-space-overlay":
                case "screenspaceoverlay": mode = RenderMode.ScreenSpaceOverlay; break;
                case "camera":
                case "screen-space-camera": mode = RenderMode.ScreenSpaceCamera; break;
                case "world":
                case "worldspace":
                case "world-space": mode = RenderMode.WorldSpace; break;
                default: return CommandResult.Fail($"Unknown renderMode '{renderModeStr}'. Use: overlay | camera | world.");
            }

            var go = new GameObject(name, typeof(RectTransform), typeof(Canvas), typeof(CanvasScaler), typeof(GraphicRaycaster));
            var canvas = go.GetComponent<Canvas>();
            canvas.renderMode = mode;

            int sortOrder = (int)SimpleJson.GetFloat(args, "sortOrder", 0);
            canvas.sortingOrder = sortOrder;

            var scaler = go.GetComponent<CanvasScaler>();
            scaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
            scaler.referenceResolution = new Vector2(1920, 1080);
            if (args.TryGetValue("referenceResolution", out object refRes)
                && UIHelpers.TryParseSize(refRes, out Vector2 refResolution))
                scaler.referenceResolution = refResolution;
            scaler.screenMatchMode = CanvasScaler.ScreenMatchMode.MatchWidthOrHeight;
            scaler.matchWidthOrHeight = 0.5f;

            Undo.RegisterCreatedObjectUndo(go, "Create UI Canvas");
            bool eventSystemCreated = UIHelpers.EnsureEventSystem();

            return CommandResult.Ok(SimpleJson.Object()
                .Put("created", true)
                .Put("name", go.name)
                .Put("path", PropertyOps.GetScenePath(go))
                .Put("instanceId", go.GetInstanceID())
                .Put("renderMode", mode.ToString())
                .Put("sortOrder", sortOrder)
                .Put("eventSystemCreated", eventSystemCreated)
                .ToString());
        }

        // ────────────────────────────────────────────────────────────────
        //  create_ui_panel
        //  Args: { parent, name?, color?, sprite?, anchor, size, ... (rect args) }
        // ────────────────────────────────────────────────────────────────
        public static CommandResult CreatePanel(Dictionary<string, object> args)
        {
            var parent = ResolveParent(args, out string parentErr);
            if (!string.IsNullOrEmpty(parentErr) && parent == null) return CommandResult.Fail(parentErr);

            string name = SimpleJson.GetString(args, "name", "Panel");
            var go = new GameObject(name, typeof(RectTransform), typeof(CanvasRenderer), typeof(Image));
            if (parent != null) go.transform.SetParent(parent, false);

            var img = go.GetComponent<Image>();

            Color color = new Color(0.1f, 0.1f, 0.1f, 0.8f);
            if (args.TryGetValue("color", out object cRaw) && UIHelpers.TryParseColor(cRaw, out Color parsed)) color = parsed;
            img.color = color;

            string spritePath = SimpleJson.GetString(args, "sprite");
            if (!string.IsNullOrEmpty(spritePath))
            {
                var sprite = AssetDatabase.LoadAssetAtPath<Sprite>(spritePath);
                if (sprite == null)
                {
                    // Probe sub-assets — sprite may live inside a Texture2D import.
                    var subs = AssetDatabase.LoadAllAssetsAtPath(spritePath);
                    foreach (var s in subs)
                    {
                        if (s is Sprite sp) { sprite = sp; break; }
                    }
                }
                if (sprite != null) img.sprite = sprite;
            }
            else
            {
                // Default to Unity's built-in UISprite (rounded-corner 9-slice) when color is opaque-ish.
                if (color.a > 0.01f)
                {
                    var uiSprite = AssetDatabase.GetBuiltinExtraResource<Sprite>("UI/Skin/UISprite.psd");
                    if (uiSprite != null) { img.sprite = uiSprite; img.type = Image.Type.Sliced; }
                }
            }

            string err = FinalizeUI(go, args, "Create UI Panel");
            if (err != null) return CommandResult.Fail(err);
            return ResultFor(go);
        }

        // ────────────────────────────────────────────────────────────────
        //  create_ui_text
        //  Args: { parent, name?, text, fontSize?, color?, alignment?, rect args }
        // ────────────────────────────────────────────────────────────────
        public static CommandResult CreateText(Dictionary<string, object> args)
        {
            var parent = ResolveParent(args, out string parentErr);
            if (!string.IsNullOrEmpty(parentErr) && parent == null) return CommandResult.Fail(parentErr);

            string name = SimpleJson.GetString(args, "name", "Text");
            string text = SimpleJson.GetString(args, "text", "");
            float fontSize = SimpleJson.GetFloat(args, "fontSize", 24f);
            Color? color = null;
            if (args.TryGetValue("color", out object cRaw) && UIHelpers.TryParseColor(cRaw, out Color c)) color = c;
            string alignment = SimpleJson.GetString(args, "alignment", "center");

            var go = new GameObject(name, typeof(RectTransform));
            if (parent != null) go.transform.SetParent(parent, false);
            UIHelpers.AddTextComponent(go, text, fontSize, color, alignment, out bool wasTmp);

            string err = FinalizeUI(go, args, "Create UI Text");
            if (err != null) return CommandResult.Fail(err);
            return ResultFor(go, "textImpl", wasTmp ? "TMP_Text" : "UnityEngine.UI.Text");
        }

        // ────────────────────────────────────────────────────────────────
        //  create_ui_image
        //  Args: { parent, name?, sprite? (path or {assetRef, subAsset}), color?, preserveAspect?, rect args }
        // ────────────────────────────────────────────────────────────────
        public static CommandResult CreateImage(Dictionary<string, object> args)
        {
            var parent = ResolveParent(args, out string parentErr);
            if (!string.IsNullOrEmpty(parentErr) && parent == null) return CommandResult.Fail(parentErr);

            string name = SimpleJson.GetString(args, "name", "Image");
            var go = new GameObject(name, typeof(RectTransform), typeof(CanvasRenderer), typeof(Image));
            if (parent != null) go.transform.SetParent(parent, false);

            var img = go.GetComponent<Image>();
            if (args.TryGetValue("color", out object cRaw) && UIHelpers.TryParseColor(cRaw, out Color c))
                img.color = c;

            string spritePath = null;
            string subAssetName = null;
            if (args.TryGetValue("sprite", out object spriteRaw))
            {
                if (spriteRaw is string sPath) spritePath = sPath;
                else if (spriteRaw is Dictionary<string, object> spriteDict)
                {
                    spritePath = SimpleJson.GetString(spriteDict, "assetRef")
                        ?? SimpleJson.GetString(spriteDict, "path");
                    subAssetName = SimpleJson.GetString(spriteDict, "subAsset");
                }
            }
            if (!string.IsNullOrEmpty(spritePath))
            {
                Sprite sprite = null;
                var subs = AssetDatabase.LoadAllAssetsAtPath(spritePath);
                if (!string.IsNullOrEmpty(subAssetName))
                {
                    foreach (var s in subs)
                        if (s is Sprite sp && sp.name == subAssetName) { sprite = sp; break; }
                }
                else
                {
                    var main = AssetDatabase.LoadAssetAtPath<Sprite>(spritePath);
                    if (main != null) sprite = main;
                    else foreach (var s in subs)
                        if (s is Sprite sp) { sprite = sp; break; }
                }
                if (sprite == null)
                    return CommandResult.Fail($"No Sprite found at '{spritePath}'{(subAssetName != null ? $" with name '{subAssetName}'" : "")}.");
                img.sprite = sprite;
            }

            if (SimpleJson.GetBool(args, "preserveAspect", false))
                img.preserveAspect = true;

            string imageTypeStr = SimpleJson.GetString(args, "imageType");
            if (!string.IsNullOrEmpty(imageTypeStr))
            {
                switch (imageTypeStr.Trim().ToLowerInvariant())
                {
                    case "simple": img.type = Image.Type.Simple; break;
                    case "sliced": img.type = Image.Type.Sliced; break;
                    case "tiled":  img.type = Image.Type.Tiled;  break;
                    case "filled": img.type = Image.Type.Filled; break;
                }
            }
            // Auto-promote to Filled if fillAmount/fillMethod given without imageType.
            if (args.TryGetValue("fillAmount", out object faRaw))
            {
                if (img.type != Image.Type.Filled) img.type = Image.Type.Filled;
                img.fillAmount = Mathf.Clamp01(UIHelpers.ToFloatSafe(faRaw, 1f));
            }
            string fmStr = SimpleJson.GetString(args, "fillMethod");
            if (!string.IsNullOrEmpty(fmStr))
            {
                if (img.type != Image.Type.Filled) img.type = Image.Type.Filled;
                switch (fmStr.Trim().ToLowerInvariant().Replace("_", ""))
                {
                    case "horizontal": img.fillMethod = Image.FillMethod.Horizontal; break;
                    case "vertical":   img.fillMethod = Image.FillMethod.Vertical; break;
                    case "radial90":   img.fillMethod = Image.FillMethod.Radial90; break;
                    case "radial180":  img.fillMethod = Image.FillMethod.Radial180; break;
                    case "radial360":  img.fillMethod = Image.FillMethod.Radial360; break;
                }
            }
            if (args.TryGetValue("fillOrigin", out object foRaw))
            {
                img.fillOrigin = (int)UIHelpers.ToFloatSafe(foRaw, 0f);
            }
            if (args.TryGetValue("fillClockwise", out object fcRaw))
            {
                img.fillClockwise = SimpleJson.GetBool(args, "fillClockwise", true);
            }

            string err = FinalizeUI(go, args, "Create UI Image");
            if (err != null) return CommandResult.Fail(err);
            return ResultFor(go);
        }

        // ────────────────────────────────────────────────────────────────
        //  create_ui_button
        //  Args: { parent, name?, text?, fontSize?, textColor?, bgColor?, sprite?, rect args }
        //  onClick wiring is out of scope for v0.2.0 — wire in the Inspector
        //  or via set-property on Button.onClick.m_PersistentCalls afterward.
        // ────────────────────────────────────────────────────────────────
        public static CommandResult CreateButton(Dictionary<string, object> args)
        {
            var parent = ResolveParent(args, out string parentErr);
            if (!string.IsNullOrEmpty(parentErr) && parent == null) return CommandResult.Fail(parentErr);

            string name = SimpleJson.GetString(args, "name", "Button");
            string label = SimpleJson.GetString(args, "label")
                        ?? SimpleJson.GetString(args, "text", "Button");
            float fontSize = SimpleJson.GetFloat(args, "fontSize", 18f);

            Color bg = new Color(0.9f, 0.9f, 0.9f, 1f);
            if (args.TryGetValue("bgColor", out object bRaw) && UIHelpers.TryParseColor(bRaw, out Color bp)) bg = bp;
            Color fg = new Color(0.15f, 0.15f, 0.15f, 1f);
            if (args.TryGetValue("textColor", out object tRaw) && UIHelpers.TryParseColor(tRaw, out Color tp)) fg = tp;

            var go = new GameObject(name, typeof(RectTransform), typeof(CanvasRenderer), typeof(Image), typeof(Button));
            if (parent != null) go.transform.SetParent(parent, false);

            var img = go.GetComponent<Image>();
            img.color = bg;
            var uiSprite = AssetDatabase.GetBuiltinExtraResource<Sprite>("UI/Skin/UISprite.psd");
            if (uiSprite != null) { img.sprite = uiSprite; img.type = Image.Type.Sliced; }
            string spritePath = SimpleJson.GetString(args, "sprite");
            if (!string.IsNullOrEmpty(spritePath))
            {
                var sprite = AssetDatabase.LoadAssetAtPath<Sprite>(spritePath);
                if (sprite != null) img.sprite = sprite;
            }

            var button = go.GetComponent<Button>();
            button.targetGraphic = img;

            var textGo = new GameObject("Text", typeof(RectTransform));
            textGo.transform.SetParent(go.transform, false);
            UIHelpers.AddTextComponent(textGo, label, fontSize, fg, "center", out bool wasTmp);
            var textRT = textGo.GetComponent<RectTransform>();
            textRT.anchorMin = Vector2.zero;
            textRT.anchorMax = Vector2.one;
            textRT.offsetMin = Vector2.zero;
            textRT.offsetMax = Vector2.zero;
            textRT.pivot = new Vector2(0.5f, 0.5f);

            if (!args.ContainsKey("size"))
            {
                var rt = go.GetComponent<RectTransform>();
                rt.sizeDelta = new Vector2(160, 40);
            }

            string err = FinalizeUI(go, args, "Create UI Button");
            if (err != null) return CommandResult.Fail(err);
            return ResultFor(go, "textImpl", wasTmp ? "TMP_Text" : "UnityEngine.UI.Text");
        }

        // ────────────────────────────────────────────────────────────────
        //  create_ui_layout_group
        //  Args: {
        //    parent,           // required — where to add the layout group
        //    kind: "vertical" | "horizontal" | "grid",
        //    spacing?, padding? (single N or [l,t,r,b]),
        //    childAlignment? ("top-left" etc.),
        //    controlChildSize? (default true), childForceExpand? (default false),
        //    fitContent? (adds ContentSizeFitter, defaults to Vertical/Horizontal based on kind),
        //    cellSize? ([w,h] — grid only)
        //  }
        //
        //  If parent already has a LayoutGroup, this reconfigures it.
        //  Otherwise adds the layout group to the parent directly (not creating a new child).
        //  Returns the GO the layout group was attached to.
        // ────────────────────────────────────────────────────────────────
        public static CommandResult CreateLayoutGroup(Dictionary<string, object> args)
        {
            var parent = ResolveParent(args, out string parentErr);
            if (parent == null)
                return CommandResult.Fail(parentErr ?? "`parent` is required (the GameObject to attach the layout group to).");

            string kind = SimpleJson.GetString(args, "kind", "vertical").Trim().ToLowerInvariant();
            string err = AttachLayoutGroup(parent.gameObject, kind, args);
            if (err != null) return CommandResult.Fail(err);
            EditorUtility.SetDirty(parent.gameObject);
            return ResultFor(parent.gameObject, "kind", kind);
        }

        /// <summary>Attach and configure a LayoutGroup on go; null on success, error message on failure.</summary>
        public static string AttachLayoutGroup(GameObject go, string kind, Dictionary<string, object> args)
        {
            // LayoutGroup variants are mutually exclusive — replace any existing.
            var existing = go.GetComponent<LayoutGroup>();
            if (existing != null) Object.DestroyImmediate(existing);

            LayoutGroup lg;
            switch (kind)
            {
                case "v":
                case "vertical":
                case "vstack":
                    lg = go.AddComponent<VerticalLayoutGroup>();
                    break;
                case "h":
                case "horizontal":
                case "hstack":
                    lg = go.AddComponent<HorizontalLayoutGroup>();
                    break;
                case "grid":
                    lg = go.AddComponent<GridLayoutGroup>();
                    break;
                default:
                    return $"Unknown layout kind '{kind}'. Use: vertical | horizontal | grid.";
            }

            if (args.TryGetValue("spacing", out object spRaw))
            {
                if (lg is HorizontalOrVerticalLayoutGroup hv)
                {
                    hv.spacing = UIHelpers.ToFloatSafe(spRaw, 0f);
                }
                else if (lg is GridLayoutGroup grid && UIHelpers.TryParseVector2(spRaw, out Vector2 gsp))
                {
                    grid.spacing = gsp;
                }
            }

            // Padding: uniform N or [l,t,r,b].
            if (args.TryGetValue("padding", out object padRaw))
            {
                RectOffset ro;
                if (padRaw is List<object> padList && padList.Count == 4)
                {
                    // RectOffset ctor is (left, right, top, bottom); input is [l,t,r,b].
                    ro = new RectOffset(
                        (int)UIHelpers.ToFloatSafe(padList[0]),
                        (int)UIHelpers.ToFloatSafe(padList[2]),
                        (int)UIHelpers.ToFloatSafe(padList[1]),
                        (int)UIHelpers.ToFloatSafe(padList[3])
                    );
                }
                else
                {
                    int uniform = (int)UIHelpers.ToFloatSafe(padRaw);
                    ro = new RectOffset(uniform, uniform, uniform, uniform);
                }
                lg.padding = ro;
            }

            string childAlignStr = SimpleJson.GetString(args, "childAlignment");
            if (!string.IsNullOrEmpty(childAlignStr))
            {
                lg.childAlignment = ParseChildAlignment(childAlignStr);
            }

            if (lg is HorizontalOrVerticalLayoutGroup hv2)
            {
                hv2.childControlWidth = SimpleJson.GetBool(args, "controlChildSize", true);
                hv2.childControlHeight = SimpleJson.GetBool(args, "controlChildSize", true);

                // childForceExpand defaults to FALSE on both axes. With forceExpand=true Unity
                // overrides every child's flexible to max(actualFlex, 1) and steals surplus from
                // fixed-size (flex=0) siblings — e.g. VStack [header=36, scroll=fill] would split
                // evenly instead of giving the scroll list everything but 36px. Cross-axis fill
                // still works because LE.flexibleSize>0 inflates to group size independently of
                // forceExpand. Override via `childForceExpandWidth` / `childForceExpandHeight`.
                hv2.childForceExpandWidth  = SimpleJson.GetBool(args, "childForceExpandWidth",  false);
                hv2.childForceExpandHeight = SimpleJson.GetBool(args, "childForceExpandHeight", false);
            }
            if (lg is GridLayoutGroup grid2 && args.TryGetValue("cellSize", out object cellRaw)
                && UIHelpers.TryParseSize(cellRaw, out Vector2 cell))
            {
                grid2.cellSize = cell;
            }

            if (SimpleJson.GetBool(args, "fitContent", false))
            {
                var fitter = go.GetComponent<ContentSizeFitter>();
                if (fitter == null) fitter = go.AddComponent<ContentSizeFitter>();
                fitter.horizontalFit = (kind == "horizontal" || kind == "grid")
                    ? ContentSizeFitter.FitMode.PreferredSize
                    : ContentSizeFitter.FitMode.Unconstrained;
                fitter.verticalFit = (kind == "vertical" || kind == "grid")
                    ? ContentSizeFitter.FitMode.PreferredSize
                    : ContentSizeFitter.FitMode.Unconstrained;
            }

            return null;
        }

        static TextAnchor ParseChildAlignment(string name)
        {
            switch (name.Trim().ToLowerInvariant().Replace('_', '-').Replace(' ', '-'))
            {
                case "top-left":      return TextAnchor.UpperLeft;
                case "top":
                case "top-center":    return TextAnchor.UpperCenter;
                case "top-right":     return TextAnchor.UpperRight;
                case "left":
                case "middle-left":   return TextAnchor.MiddleLeft;
                case "center":
                case "middle":
                case "middle-center": return TextAnchor.MiddleCenter;
                case "right":
                case "middle-right":  return TextAnchor.MiddleRight;
                case "bottom-left":   return TextAnchor.LowerLeft;
                case "bottom":
                case "bottom-center": return TextAnchor.LowerCenter;
                case "bottom-right":  return TextAnchor.LowerRight;
                default:              return TextAnchor.MiddleCenter;
            }
        }

        // ────────────────────────────────────────────────────────────────
        //  create_ui_scroll_list
        //  Args: { parent, name?, direction: "vertical"|"horizontal"|"both",
        //          contentLayout: "vertical"|"horizontal"|"grid" (for child arrangement),
        //          spacing?, padding?, rect args }
        //  Creates: ScrollRect + Viewport (with Mask) + Content (with LayoutGroup + Fitter).
        //  Returns content path so callers know where to add child items.
        // ────────────────────────────────────────────────────────────────
        public static CommandResult CreateScrollList(Dictionary<string, object> args)
        {
            var parent = ResolveParent(args, out string parentErr);
            if (!string.IsNullOrEmpty(parentErr) && parent == null) return CommandResult.Fail(parentErr);

            string name = SimpleJson.GetString(args, "name", "ScrollList");
            string direction = SimpleJson.GetString(args, "direction", "vertical").Trim().ToLowerInvariant();
            string contentLayout = SimpleJson.GetString(args, "contentLayout", direction);

            var root = new GameObject(name, typeof(RectTransform), typeof(CanvasRenderer), typeof(Image), typeof(ScrollRect));
            if (parent != null) root.transform.SetParent(parent, false);
            var rootImg = root.GetComponent<Image>();
            rootImg.color = new Color(0, 0, 0, 0.25f);
            var scroll = root.GetComponent<ScrollRect>();

            var viewport = new GameObject("Viewport", typeof(RectTransform), typeof(CanvasRenderer), typeof(Image), typeof(Mask));
            viewport.transform.SetParent(root.transform, false);
            var vpImg = viewport.GetComponent<Image>();
            vpImg.color = Color.white; // Mask requires a graphic; alpha is ignored.
            var mask = viewport.GetComponent<Mask>();
            mask.showMaskGraphic = false;
            var vpRT = viewport.GetComponent<RectTransform>();
            vpRT.anchorMin = Vector2.zero;
            vpRT.anchorMax = Vector2.one;
            vpRT.offsetMin = Vector2.zero;
            vpRT.offsetMax = Vector2.zero;
            vpRT.pivot = new Vector2(0, 1);

            // Horizontal scrolling needs Content free to grow past Viewport width — anchor top-left,
            // size via fitter. Vertical-only stretches Content horizontally for nicer text reflow.
            bool horizontalScroll = direction == "horizontal" || direction == "both";
            var content = new GameObject("Content", typeof(RectTransform));
            content.transform.SetParent(viewport.transform, false);
            var contentRT = content.GetComponent<RectTransform>();
            if (horizontalScroll)
            {
                contentRT.anchorMin = new Vector2(0, 1);
                contentRT.anchorMax = new Vector2(0, 1);
                contentRT.pivot = new Vector2(0, 1);
            }
            else
            {
                contentRT.anchorMin = new Vector2(0, 1);
                contentRT.anchorMax = new Vector2(1, 1);
                contentRT.pivot = new Vector2(0, 1);
            }
            contentRT.sizeDelta = new Vector2(0, 0);
            contentRT.anchoredPosition = Vector2.zero;

            var layoutArgs = new Dictionary<string, object> { ["fitContent"] = true };
            if (args.TryGetValue("spacing", out object sp)) layoutArgs["spacing"] = sp;
            if (args.TryGetValue("padding", out object pad)) layoutArgs["padding"] = pad;
            AttachLayoutGroup(content, contentLayout, layoutArgs);

            // AttachLayoutGroup's fitContent only sets horizontalFit when layout is horizontal/grid.
            // A both-scrolling list with vertical layout still needs horizontalFit so children can push Content past Viewport width.
            if (horizontalScroll)
            {
                var fitter = content.GetComponent<ContentSizeFitter>();
                if (fitter == null) fitter = content.AddComponent<ContentSizeFitter>();
                fitter.horizontalFit = ContentSizeFitter.FitMode.PreferredSize;
                if (fitter.verticalFit == ContentSizeFitter.FitMode.Unconstrained)
                    fitter.verticalFit = ContentSizeFitter.FitMode.PreferredSize;
            }

            scroll.viewport = vpRT;
            scroll.content = contentRT;
            switch (direction)
            {
                case "horizontal": scroll.horizontal = true;  scroll.vertical = false; break;
                case "both":       scroll.horizontal = true;  scroll.vertical = true;  break;
                default:           scroll.horizontal = false; scroll.vertical = true;  break;
            }
            scroll.movementType = ScrollRect.MovementType.Elastic;

            // Zero scrollSensitivity at build time (not just MapPanZoom.Awake) so the serialized
            // scene asset reflects the change — otherwise the asset shows sensitivity=1 even
            // though the runtime value gets zeroed, confusing diffs/inspect.
            if (SimpleJson.GetBool(args, "mapPanZoom", false))
            {
                root.AddComponent<Dreamer.AgentBridge.UGUI.MapPanZoom>();
                scroll.scrollSensitivity = 0f;
            }

            string err = FinalizeUI(root, args, "Create UI Scroll List");
            if (err != null) return CommandResult.Fail(err);

            return CommandResult.Ok(SimpleJson.Object()
                .Put("created", true)
                .Put("name", root.name)
                .Put("path", PropertyOps.GetScenePath(root))
                .Put("contentPath", PropertyOps.GetScenePath(content))
                .Put("viewportPath", PropertyOps.GetScenePath(viewport))
                .Put("direction", direction)
                .Put("contentLayout", contentLayout)
                .ToString());
        }

        // ────────────────────────────────────────────────────────────────
        //  create_ui_slider
        //  Args: { parent, name?, min?, max?, value?, whole?, direction?, rect args }
        // ────────────────────────────────────────────────────────────────
        public static CommandResult CreateSlider(Dictionary<string, object> args)
        {
            var parent = ResolveParent(args, out string parentErr);
            if (!string.IsNullOrEmpty(parentErr) && parent == null) return CommandResult.Fail(parentErr);

            string name = SimpleJson.GetString(args, "name", "Slider");
            var root = new GameObject(name, typeof(RectTransform), typeof(Slider));
            if (parent != null) root.transform.SetParent(parent, false);

            var bg = new GameObject("Background", typeof(RectTransform), typeof(CanvasRenderer), typeof(Image));
            bg.transform.SetParent(root.transform, false);
            var bgRT = bg.GetComponent<RectTransform>();
            bgRT.anchorMin = new Vector2(0, 0.25f); bgRT.anchorMax = new Vector2(1, 0.75f);
            bgRT.offsetMin = Vector2.zero; bgRT.offsetMax = Vector2.zero;
            bg.GetComponent<Image>().color = new Color(0.7f, 0.7f, 0.7f, 1f);

            var fillArea = new GameObject("Fill Area", typeof(RectTransform));
            fillArea.transform.SetParent(root.transform, false);
            var faRT = fillArea.GetComponent<RectTransform>();
            faRT.anchorMin = new Vector2(0, 0.25f); faRT.anchorMax = new Vector2(1, 0.75f);
            faRT.offsetMin = new Vector2(5, 0); faRT.offsetMax = new Vector2(-15, 0);

            var fill = new GameObject("Fill", typeof(RectTransform), typeof(CanvasRenderer), typeof(Image));
            fill.transform.SetParent(fillArea.transform, false);
            var fillRT = fill.GetComponent<RectTransform>();
            fillRT.anchorMin = Vector2.zero; fillRT.anchorMax = Vector2.one;
            fillRT.offsetMin = Vector2.zero; fillRT.offsetMax = Vector2.zero;
            fill.GetComponent<Image>().color = new Color(0.3f, 0.5f, 0.9f, 1f);

            var handleArea = new GameObject("Handle Slide Area", typeof(RectTransform));
            handleArea.transform.SetParent(root.transform, false);
            var haRT = handleArea.GetComponent<RectTransform>();
            haRT.anchorMin = new Vector2(0, 0); haRT.anchorMax = new Vector2(1, 1);
            haRT.offsetMin = new Vector2(10, 0); haRT.offsetMax = new Vector2(-10, 0);

            var handle = new GameObject("Handle", typeof(RectTransform), typeof(CanvasRenderer), typeof(Image));
            handle.transform.SetParent(handleArea.transform, false);
            var hRT = handle.GetComponent<RectTransform>();
            hRT.anchorMin = new Vector2(0, 0); hRT.anchorMax = new Vector2(0, 1);
            hRT.sizeDelta = new Vector2(20, 0);
            handle.GetComponent<Image>().color = Color.white;

            var slider = root.GetComponent<Slider>();
            slider.fillRect = fillRT;
            slider.handleRect = hRT;
            slider.targetGraphic = handle.GetComponent<Image>();
            slider.minValue = SimpleJson.GetFloat(args, "min", 0f);
            slider.maxValue = SimpleJson.GetFloat(args, "max", 1f);
            slider.value = SimpleJson.GetFloat(args, "value", slider.minValue);
            slider.wholeNumbers = SimpleJson.GetBool(args, "whole", false);
            string dir = SimpleJson.GetString(args, "direction", "left-to-right").Trim().ToLowerInvariant();
            switch (dir)
            {
                case "right-to-left": slider.direction = Slider.Direction.RightToLeft; break;
                case "top-to-bottom": slider.direction = Slider.Direction.TopToBottom; break;
                case "bottom-to-top": slider.direction = Slider.Direction.BottomToTop; break;
                default: slider.direction = Slider.Direction.LeftToRight; break;
            }

            if (!args.ContainsKey("size"))
            {
                var rt = root.GetComponent<RectTransform>();
                rt.sizeDelta = new Vector2(200, 20);
            }
            string err = FinalizeUI(root, args, "Create UI Slider");
            if (err != null) return CommandResult.Fail(err);
            return ResultFor(root);
        }

        // ────────────────────────────────────────────────────────────────
        //  create_ui_toggle
        //  Args: { parent, name?, label?, isOn?, rect args }
        // ────────────────────────────────────────────────────────────────
        public static CommandResult CreateToggle(Dictionary<string, object> args)
        {
            var parent = ResolveParent(args, out string parentErr);
            if (!string.IsNullOrEmpty(parentErr) && parent == null) return CommandResult.Fail(parentErr);

            string name = SimpleJson.GetString(args, "name", "Toggle");
            var root = new GameObject(name, typeof(RectTransform), typeof(Toggle));
            if (parent != null) root.transform.SetParent(parent, false);

            var bg = new GameObject("Background", typeof(RectTransform), typeof(CanvasRenderer), typeof(Image));
            bg.transform.SetParent(root.transform, false);
            var bgRT = bg.GetComponent<RectTransform>();
            bgRT.anchorMin = new Vector2(0, 0.5f); bgRT.anchorMax = new Vector2(0, 0.5f);
            bgRT.pivot = new Vector2(0, 0.5f);
            bgRT.sizeDelta = new Vector2(20, 20);
            bgRT.anchoredPosition = new Vector2(0, 0);
            bg.GetComponent<Image>().color = Color.white;

            var check = new GameObject("Checkmark", typeof(RectTransform), typeof(CanvasRenderer), typeof(Image));
            check.transform.SetParent(bg.transform, false);
            var cRT = check.GetComponent<RectTransform>();
            cRT.anchorMin = Vector2.zero; cRT.anchorMax = Vector2.one;
            cRT.offsetMin = new Vector2(2, 2); cRT.offsetMax = new Vector2(-2, -2);
            check.GetComponent<Image>().color = new Color(0.2f, 0.6f, 1f, 1f);

            // Only emit the internal label when caller passes a non-empty `label`. Defaulting to
            // "Toggle" broke checkbox-only toggles (size [28,28]): the label stretch-filled into
            // the 3px between the 25px checkbox offset and the 28px toggle width, jamming "Toggle"
            // into a sliver. Callers who want an external label position it as a sibling.
            string label = SimpleJson.GetString(args, "label", "");
            if (!string.IsNullOrEmpty(label))
            {
                var lblGo = new GameObject("Label", typeof(RectTransform));
                lblGo.transform.SetParent(root.transform, false);
                UIHelpers.AddTextComponent(lblGo, label, 16f, Color.black, "middle-left", out _);
                var lRT = lblGo.GetComponent<RectTransform>();
                lRT.anchorMin = new Vector2(0, 0); lRT.anchorMax = new Vector2(1, 1);
                lRT.offsetMin = new Vector2(25, 0); lRT.offsetMax = Vector2.zero;
                lRT.pivot = new Vector2(0, 0.5f);
            }

            var toggle = root.GetComponent<Toggle>();
            toggle.targetGraphic = bg.GetComponent<Image>();
            toggle.graphic = check.GetComponent<Image>();
            toggle.isOn = SimpleJson.GetBool(args, "isOn", false);

            if (!args.ContainsKey("size"))
            {
                var rt = root.GetComponent<RectTransform>();
                rt.sizeDelta = string.IsNullOrEmpty(label) ? new Vector2(20, 20) : new Vector2(160, 20);
            }
            string err = FinalizeUI(root, args, "Create UI Toggle");
            if (err != null) return CommandResult.Fail(err);
            return ResultFor(root);
        }

        // ────────────────────────────────────────────────────────────────
        //  create_ui_input_field
        //  Args: { parent, name?, placeholder?, text?, rect args }
        //  Uses TMP_InputField when DREAMER_HAS_TMP is defined (Unity 6's merged
        //  ugui+TMP package or any project with com.unity.textmeshpro installed).
        //  Falls back to legacy UnityEngine.UI.InputField when TMP is absent —
        //  keeps consistency with AddTextComponent's TMP-first Text rendering
        //  so the placeholder and typed text match surrounding labels.
        // ────────────────────────────────────────────────────────────────
        public static CommandResult CreateInputField(Dictionary<string, object> args)
        {
            var parent = ResolveParent(args, out string parentErr);
            if (!string.IsNullOrEmpty(parentErr) && parent == null) return CommandResult.Fail(parentErr);

            string name = SimpleJson.GetString(args, "name", "InputField");
            string placeholder = SimpleJson.GetString(args, "placeholder", "Enter text...");
            string initialText = SimpleJson.GetString(args, "text", "");

#if DREAMER_HAS_TMP
            var root = new GameObject(name, typeof(RectTransform), typeof(CanvasRenderer), typeof(Image), typeof(TMP_InputField));
#else
            var root = new GameObject(name, typeof(RectTransform), typeof(CanvasRenderer), typeof(Image), typeof(InputField));
#endif
            if (parent != null) root.transform.SetParent(parent, false);
            var bgImg = root.GetComponent<Image>();
            bgImg.color = Color.white;
            var uiSprite = AssetDatabase.GetBuiltinExtraResource<Sprite>("UI/Skin/InputFieldBackground.psd");
            if (uiSprite != null) { bgImg.sprite = uiSprite; bgImg.type = Image.Type.Sliced; }

#if DREAMER_HAS_TMP
            // TMP_InputField requires a Text Area child owning the Mask/viewport with TMP_Text as its
            // child — matches Unity's GameObject > UI > Input Field - TextMeshPro structure.
            var textArea = new GameObject("Text Area", typeof(RectTransform), typeof(RectMask2D));
            textArea.transform.SetParent(root.transform, false);
            var taRT = textArea.GetComponent<RectTransform>();
            taRT.anchorMin = Vector2.zero; taRT.anchorMax = Vector2.one;
            taRT.offsetMin = new Vector2(10, 6); taRT.offsetMax = new Vector2(-10, -7);

            var phGo = new GameObject("Placeholder", typeof(RectTransform));
            phGo.transform.SetParent(textArea.transform, false);
            var phTmp = phGo.AddComponent<TextMeshProUGUI>();
            phTmp.text = placeholder;
            phTmp.fontSize = 14;
            phTmp.color = new Color(0.5f, 0.5f, 0.5f, 0.6f);
            phTmp.alignment = TextAlignmentOptions.MidlineLeft;
            phTmp.enableWordWrapping = false;
            phTmp.overflowMode = TextOverflowModes.Ellipsis;
            var phRT = phGo.GetComponent<RectTransform>();
            phRT.anchorMin = Vector2.zero; phRT.anchorMax = Vector2.one;
            phRT.offsetMin = Vector2.zero; phRT.offsetMax = Vector2.zero;

            var textGo = new GameObject("Text", typeof(RectTransform));
            textGo.transform.SetParent(textArea.transform, false);
            var textTmp = textGo.AddComponent<TextMeshProUGUI>();
            textTmp.text = initialText;
            textTmp.fontSize = 14;
            textTmp.color = Color.black;
            textTmp.alignment = TextAlignmentOptions.MidlineLeft;
            textTmp.enableWordWrapping = false;
            textTmp.overflowMode = TextOverflowModes.Overflow;
            var tRT = textGo.GetComponent<RectTransform>();
            tRT.anchorMin = Vector2.zero; tRT.anchorMax = Vector2.one;
            tRT.offsetMin = Vector2.zero; tRT.offsetMax = Vector2.zero;

            var input = root.GetComponent<TMP_InputField>();
            input.targetGraphic = bgImg;
            input.textViewport = taRT;
            input.textComponent = textTmp;
            input.placeholder = phTmp;
            input.text = initialText;
#else
            var phGo = new GameObject("Placeholder", typeof(RectTransform));
            phGo.transform.SetParent(root.transform, false);
            UIHelpers.AddTextComponent(phGo, placeholder, 14f, new Color(0.5f, 0.5f, 0.5f, 0.6f), "middle-left", out _);
            var phRT = phGo.GetComponent<RectTransform>();
            phRT.anchorMin = Vector2.zero; phRT.anchorMax = Vector2.one;
            phRT.offsetMin = new Vector2(10, 6); phRT.offsetMax = new Vector2(-10, -7);

            var textGo = new GameObject("Text", typeof(RectTransform));
            textGo.transform.SetParent(root.transform, false);
            UIHelpers.AddTextComponent(textGo, initialText, 14f, Color.black, "middle-left", out _);
            var tRT = textGo.GetComponent<RectTransform>();
            tRT.anchorMin = Vector2.zero; tRT.anchorMax = Vector2.one;
            tRT.offsetMin = new Vector2(10, 6); tRT.offsetMax = new Vector2(-10, -7);

            var input = root.GetComponent<InputField>();
            input.targetGraphic = bgImg;
            input.textComponent = textGo.GetComponent<Text>();
            input.placeholder = phGo.GetComponent<Text>();
            input.text = initialText;
#endif

            if (!args.ContainsKey("size"))
            {
                var rt = root.GetComponent<RectTransform>();
                rt.sizeDelta = new Vector2(200, 30);
            }
            string err = FinalizeUI(root, args, "Create UI InputField");
            if (err != null) return CommandResult.Fail(err);
            return ResultFor(root);
        }

#if !DREAMER_HAS_TMP
        // Force legacy Text (NOT TMP) for Dropdown/InputField legacy fallbacks — their captionText/
        // textComponent properties are typed `Text` and NRE at runtime if handed a TMP component.
        static Text AddLegacyText(GameObject go, string text, float fontSize, Color color, TextAnchor alignment)
        {
            var t = go.AddComponent<Text>();
            t.text = text ?? "";
            t.fontSize = Mathf.RoundToInt(fontSize);
            t.color = color;
            t.alignment = alignment;
            t.horizontalOverflow = HorizontalWrapMode.Wrap;
            t.verticalOverflow = VerticalWrapMode.Truncate;
            t.font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf")
                  ?? Resources.GetBuiltinResource<Font>("Arial.ttf");
            return t;
        }
#endif

        // ────────────────────────────────────────────────────────────────
        //  create_ui_dropdown
        //  Args: { parent, name?, options?: ["a","b",...], value?: int (selected index),
        //          captionFontSize?, itemFontSize?, rect args }
        //  Builds a fully-functional TMP_Dropdown (or legacy UnityEngine.UI.Dropdown
        //  when DREAMER_HAS_TMP is not defined) with caption + arrow + popup template.
        //  Populated with options; value selects initial item. The user can wire
        //  onValueChanged via Inspector or set-property on m_OnValueChanged.m_PersistentCalls
        //  afterward; nothing else is needed for the widget to work in Play Mode.
        // ────────────────────────────────────────────────────────────────
        public static CommandResult CreateDropdown(Dictionary<string, object> args)
        {
            var parent = ResolveParent(args, out string parentErr);
            if (!string.IsNullOrEmpty(parentErr) && parent == null) return CommandResult.Fail(parentErr);

            string name = SimpleJson.GetString(args, "name", "Dropdown");
            float captionFontSize = SimpleJson.GetFloat(args, "captionFontSize", 14f);
            float itemFontSize    = SimpleJson.GetFloat(args, "itemFontSize",    14f);

#if DREAMER_HAS_TMP
            var root = new GameObject(name, typeof(RectTransform), typeof(CanvasRenderer), typeof(Image), typeof(TMP_Dropdown));
#else
            var root = new GameObject(name, typeof(RectTransform), typeof(CanvasRenderer), typeof(Image), typeof(Dropdown));
#endif
            if (parent != null) root.transform.SetParent(parent, false);
            var bgImg = root.GetComponent<Image>();
            bgImg.color = new Color(0.95f, 0.95f, 0.95f, 1f);
            var uiBg = AssetDatabase.GetBuiltinExtraResource<Sprite>("UI/Skin/UISprite.psd");
            if (uiBg != null) { bgImg.sprite = uiBg; bgImg.type = Image.Type.Sliced; }

            // Caption: TMP_Dropdown.captionText requires TMP_Text; legacy Dropdown.captionText requires legacy Text (NRE on wrong type).
            var label = new GameObject("Label", typeof(RectTransform));
            label.transform.SetParent(root.transform, false);
#if DREAMER_HAS_TMP
            var labelTmp = label.AddComponent<TextMeshProUGUI>();
            labelTmp.text = "";
            labelTmp.fontSize = captionFontSize;
            labelTmp.color = new Color(0.15f, 0.15f, 0.15f, 1f);
            labelTmp.alignment = TextAlignmentOptions.MidlineLeft;
            labelTmp.enableWordWrapping = false;
            labelTmp.overflowMode = TextOverflowModes.Ellipsis;
#else
            AddLegacyText(label, "", captionFontSize, new Color(0.15f, 0.15f, 0.15f, 1f), TextAnchor.MiddleLeft);
#endif
            var lblRT = label.GetComponent<RectTransform>();
            lblRT.anchorMin = Vector2.zero; lblRT.anchorMax = Vector2.one;
            lblRT.offsetMin = new Vector2(10, 6); lblRT.offsetMax = new Vector2(-25, -7);

            var arrow = new GameObject("Arrow", typeof(RectTransform), typeof(CanvasRenderer), typeof(Image));
            arrow.transform.SetParent(root.transform, false);
            var arrowImg = arrow.GetComponent<Image>();
            var arrowSpr = AssetDatabase.GetBuiltinExtraResource<Sprite>("UI/Skin/DropdownArrow.psd");
            if (arrowSpr != null) arrowImg.sprite = arrowSpr;
            arrowImg.color = new Color(0.15f, 0.15f, 0.15f, 1f);
            var arRT = arrow.GetComponent<RectTransform>();
            arRT.anchorMin = new Vector2(1, 0.5f); arRT.anchorMax = new Vector2(1, 0.5f);
            arRT.pivot = new Vector2(1, 0.5f);
            arRT.sizeDelta = new Vector2(20, 20);
            arRT.anchoredPosition = new Vector2(-8, 0);

            // Template: prototype that Dropdown clones when opened.
            var template = new GameObject("Template", typeof(RectTransform), typeof(CanvasRenderer), typeof(Image), typeof(ScrollRect));
            template.transform.SetParent(root.transform, false);
            template.SetActive(false);
            var tImg = template.GetComponent<Image>();
            tImg.color = Color.white;
            if (uiBg != null) { tImg.sprite = uiBg; tImg.type = Image.Type.Sliced; }
            var tRT = template.GetComponent<RectTransform>();
            tRT.anchorMin = new Vector2(0, 0); tRT.anchorMax = new Vector2(1, 0);
            tRT.pivot = new Vector2(0.5f, 1);
            tRT.anchoredPosition = new Vector2(0, 2);
            tRT.sizeDelta = new Vector2(0, 150);

            // 3px inset so the mask doesn't paint over the template sprite's rounded corners.
            // Set pivot BEFORE offsets — Unity recomputes derived values on each set.
            var vp = new GameObject("Viewport", typeof(RectTransform), typeof(CanvasRenderer), typeof(Image), typeof(Mask));
            vp.transform.SetParent(template.transform, false);
            var vpImg = vp.GetComponent<Image>();
            vpImg.color = Color.white;
            vp.GetComponent<Mask>().showMaskGraphic = false;
            var vpRT = vp.GetComponent<RectTransform>();
            vpRT.anchorMin = new Vector2(0, 0);
            vpRT.anchorMax = new Vector2(1, 1);
            vpRT.pivot = new Vector2(0.5f, 1);
            vpRT.offsetMin = new Vector2(3, 3);
            vpRT.offsetMax = new Vector2(-3, -3);

            var contentGo = new GameObject("Content", typeof(RectTransform));
            contentGo.transform.SetParent(vp.transform, false);
            var cRT = contentGo.GetComponent<RectTransform>();
            cRT.anchorMin = new Vector2(0, 1); cRT.anchorMax = new Vector2(1, 1);
            cRT.pivot = new Vector2(0.5f, 1);
            cRT.sizeDelta = new Vector2(0, 28);

            var item = new GameObject("Item", typeof(RectTransform), typeof(Toggle));
            item.transform.SetParent(contentGo.transform, false);
            var itemRT = item.GetComponent<RectTransform>();
            itemRT.anchorMin = new Vector2(0, 0.5f); itemRT.anchorMax = new Vector2(1, 0.5f);
            itemRT.pivot = new Vector2(0.5f, 0.5f);
            itemRT.sizeDelta = new Vector2(0, 20);

            var itemBg = new GameObject("Item Background", typeof(RectTransform), typeof(CanvasRenderer), typeof(Image));
            itemBg.transform.SetParent(item.transform, false);
            var ibImg = itemBg.GetComponent<Image>();
            ibImg.color = new Color(0.96f, 0.96f, 0.96f, 1f);
            var ibRT = itemBg.GetComponent<RectTransform>();
            ibRT.anchorMin = Vector2.zero; ibRT.anchorMax = Vector2.one;
            ibRT.offsetMin = Vector2.zero; ibRT.offsetMax = Vector2.zero;

            var itemCheck = new GameObject("Item Checkmark", typeof(RectTransform), typeof(CanvasRenderer), typeof(Image));
            itemCheck.transform.SetParent(item.transform, false);
            var icImg = itemCheck.GetComponent<Image>();
            var checkSpr = AssetDatabase.GetBuiltinExtraResource<Sprite>("UI/Skin/Checkmark.psd");
            if (checkSpr != null) icImg.sprite = checkSpr;
            icImg.color = new Color(0.15f, 0.15f, 0.15f, 1f);
            var icRT = itemCheck.GetComponent<RectTransform>();
            icRT.anchorMin = new Vector2(0, 0.5f); icRT.anchorMax = new Vector2(0, 0.5f);
            icRT.pivot = new Vector2(0.5f, 0.5f);
            icRT.sizeDelta = new Vector2(20, 20);
            icRT.anchoredPosition = new Vector2(10, 0);

            // Same TMP/legacy split as the caption label (typed property NRE).
            var itemLabel = new GameObject("Item Label", typeof(RectTransform));
            itemLabel.transform.SetParent(item.transform, false);
#if DREAMER_HAS_TMP
            var itemLabelTmp = itemLabel.AddComponent<TextMeshProUGUI>();
            itemLabelTmp.text = "Option";
            itemLabelTmp.fontSize = itemFontSize;
            itemLabelTmp.color = new Color(0.15f, 0.15f, 0.15f, 1f);
            itemLabelTmp.alignment = TextAlignmentOptions.MidlineLeft;
            itemLabelTmp.enableWordWrapping = false;
            itemLabelTmp.overflowMode = TextOverflowModes.Ellipsis;
#else
            AddLegacyText(itemLabel, "Option", itemFontSize, new Color(0.15f, 0.15f, 0.15f, 1f), TextAnchor.MiddleLeft);
#endif
            var ilRT = itemLabel.GetComponent<RectTransform>();
            ilRT.anchorMin = Vector2.zero; ilRT.anchorMax = Vector2.one;
            ilRT.offsetMin = new Vector2(20, 1); ilRT.offsetMax = new Vector2(-10, -2);

            var toggle = item.GetComponent<Toggle>();
            toggle.targetGraphic = ibImg;
            toggle.graphic = icImg;
            toggle.isOn = true;

            // No Template Scrollbar — Dropdown still works without it (just no scrollbar visible on overflow).
            var sr = template.GetComponent<ScrollRect>();
            sr.viewport = vpRT;
            sr.content = cRT;
            sr.horizontal = false;
            sr.vertical = true;
            sr.movementType = ScrollRect.MovementType.Clamped;

#if DREAMER_HAS_TMP
            var dd = root.GetComponent<TMP_Dropdown>();
            dd.template = tRT;
            dd.captionText = labelTmp;
            dd.itemText = itemLabelTmp;
            dd.targetGraphic = bgImg;

            dd.options.Clear();
            if (args.TryGetValue("options", out object optsRaw) && optsRaw is List<object> optsList)
            {
                foreach (var o in optsList)
                {
                    string s = o?.ToString() ?? "";
                    dd.options.Add(new TMP_Dropdown.OptionData(s));
                }
            }
            int initialValue = (int)SimpleJson.GetFloat(args, "value", 0f);
            if (dd.options.Count > 0)
            {
                dd.value = Mathf.Clamp(initialValue, 0, dd.options.Count - 1);
                dd.captionText.text = dd.options[dd.value].text;
            }
#else
            var dd = root.GetComponent<Dropdown>();
            dd.template = tRT;
            dd.captionText = label.GetComponent<Text>();
            dd.itemText = itemLabel.GetComponent<Text>();
            dd.targetGraphic = bgImg;

            dd.options.Clear();
            if (args.TryGetValue("options", out object optsRaw) && optsRaw is List<object> optsList)
            {
                foreach (var o in optsList)
                {
                    string s = o?.ToString() ?? "";
                    dd.options.Add(new Dropdown.OptionData(s));
                }
            }
            int initialValue = (int)SimpleJson.GetFloat(args, "value", 0f);
            if (dd.options.Count > 0)
            {
                dd.value = Mathf.Clamp(initialValue, 0, dd.options.Count - 1);
                dd.captionText.text = dd.options[dd.value].text;
            }
#endif

            if (!args.ContainsKey("size"))
            {
                var rt = root.GetComponent<RectTransform>();
                rt.sizeDelta = new Vector2(200, 32);
            }
            string err = FinalizeUI(root, args, "Create UI Dropdown");
            if (err != null) return CommandResult.Fail(err);
            return ResultFor(root);
        }
    }
}
