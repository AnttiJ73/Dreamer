using System;
using System.Collections.Generic;
using UnityEditor;
using UnityEngine;
using UnityEngine.UI;
using Object = UnityEngine.Object;

namespace Dreamer.AgentBridge
{
    /// <summary>
    /// Tier 3 of the UI support — declarative tree builder.
    /// One command, one nested JSON spec, a full UI subtree goes up.
    ///
    /// Supports four construction modes, so callers can start the tree at
    /// any point in the scene hierarchy, not just a canvas root:
    ///   - "create": build a fresh Canvas and tree beneath it
    ///   - "append": add the tree as a child of the specified target
    ///   - "replace-children": delete all children of target, rebuild from tree
    ///   - "replace-self": delete target, put the new tree in its place (as
    ///     a child of target's parent)
    ///
    /// Node types available: Panel, Image, Text, Button, VStack, HStack, Grid,
    /// ScrollList, Slider, Toggle, InputField, Spacer, Raw.
    /// </summary>
    public static class UITreeOps
    {
        /// <summary>
        /// Args: {
        ///   mode: "create" | "append" | "replace-children" | "replace-self",
        ///   target?: "/Canvas/MainPanel",        // required for append/replace-*
        ///   canvas?: { ... },                    // for mode=create
        ///   tree: { type, name, anchor, size, children?: [...], ... }
        /// }
        /// Returns { created: true, rootPath, builtCount, warnings? }
        /// </summary>
        public static CommandResult CreateUITree(Dictionary<string, object> args)
        {
            string modeStr = SimpleJson.GetString(args, "mode", "create").Trim().ToLowerInvariant();
            var treeSpec = UIHelpers.AsDict(SimpleJson.GetValue(args, "tree"));
            if (treeSpec == null && modeStr != "replace-children")
                return CommandResult.Fail("`tree` is required (a node spec with at least `type`).");

            GameObject rootGo;
            Transform buildParent;
            var warnings = new List<string>();

            switch (modeStr)
            {
                case "create":
                {
                    // Build a fresh canvas then place the tree under it.
                    var canvasSpec = UIHelpers.AsDict(SimpleJson.GetValue(args, "canvas")) ?? new Dictionary<string, object>();
                    var canvasResult = UIWidgetOps.CreateCanvas(canvasSpec);
                    if (!canvasResult.success)
                        return CommandResult.Fail($"Failed to create canvas: {canvasResult.error}");
                    var canvasGo = FindChildByResult(null, canvasResult);
                    if (canvasGo == null)
                        return CommandResult.Fail("Canvas created but can't resolve it to continue tree build.");
                    buildParent = canvasGo.transform;
                    rootGo = BuildNode(treeSpec, buildParent, warnings);
                    return OkResult(rootGo, warnings);
                }

                case "append":
                {
                    string targetPath = SimpleJson.GetString(args, "target");
                    if (string.IsNullOrEmpty(targetPath))
                        return CommandResult.Fail("`target` is required for mode 'append' (path of the parent GameObject).");
                    var target = PropertyOps.FindSceneObject(targetPath, out string tErr);
                    if (target == null) return CommandResult.Fail(tErr ?? $"Target not found: {targetPath}");
                    rootGo = BuildNode(treeSpec, target.transform, warnings);
                    return OkResult(rootGo, warnings);
                }

                case "replace-children":
                {
                    string targetPath = SimpleJson.GetString(args, "target");
                    if (string.IsNullOrEmpty(targetPath))
                        return CommandResult.Fail("`target` is required for mode 'replace-children'.");
                    var target = PropertyOps.FindSceneObject(targetPath, out string tErr);
                    if (target == null) return CommandResult.Fail(tErr ?? $"Target not found: {targetPath}");

                    int removed = DestroyAllChildren(target.transform);

                    if (treeSpec != null)
                    {
                        rootGo = BuildNode(treeSpec, target.transform, warnings);
                    }
                    else
                    {
                        // mode=replace-children with no tree == just clear
                        rootGo = target;
                    }
                    return OkResult(rootGo, warnings, extraKey: "childrenRemoved", extraVal: removed);
                }

                case "replace-self":
                {
                    string targetPath = SimpleJson.GetString(args, "target");
                    if (string.IsNullOrEmpty(targetPath))
                        return CommandResult.Fail("`target` is required for mode 'replace-self'.");
                    var target = PropertyOps.FindSceneObject(targetPath, out string tErr);
                    if (target == null) return CommandResult.Fail(tErr ?? $"Target not found: {targetPath}");

                    var parentT = target.transform.parent;
                    if (parentT == null)
                        return CommandResult.Fail("Cannot replace-self on a root-level GameObject (no parent to reattach to). Use 'replace-children' on the root instead.");

                    int siblingIndex = target.transform.GetSiblingIndex();
                    Undo.DestroyObjectImmediate(target);

                    rootGo = BuildNode(treeSpec, parentT, warnings);
                    if (rootGo != null) rootGo.transform.SetSiblingIndex(siblingIndex);
                    return OkResult(rootGo, warnings);
                }

                default:
                    return CommandResult.Fail($"Unknown mode '{modeStr}'. Use: create | append | replace-children | replace-self.");
            }
        }

        static CommandResult OkResult(GameObject rootGo, List<string> warnings, string extraKey = null, object extraVal = null)
        {
            var json = SimpleJson.Object()
                .Put("created", true)
                .Put("rootPath", rootGo != null ? PropertyOps.GetScenePath(rootGo) : null);
            if (extraKey != null)
            {
                if (extraVal is int i) json.Put(extraKey, i);
                else if (extraVal is string s) json.Put(extraKey, s);
            }
            if (warnings.Count > 0)
            {
                var arr = SimpleJson.Array();
                foreach (var w in warnings) arr.Add(w);
                json.PutRaw("warnings", arr.ToString());
            }
            return CommandResult.Ok(json.ToString());
        }

        static int DestroyAllChildren(Transform parent)
        {
            int count = parent.childCount;
            for (int i = count - 1; i >= 0; i--)
            {
                Undo.DestroyObjectImmediate(parent.GetChild(i).gameObject);
            }
            return count;
        }

        // ────────────────────────────────────────────────────────────────
        //  Node construction
        // ────────────────────────────────────────────────────────────────

        /// <summary>
        /// Build a single node and recursively its children. Returns the
        /// GameObject at the root of this node, or null on failure (with a
        /// warning added).
        /// </summary>
        static GameObject BuildNode(Dictionary<string, object> spec, Transform parent, List<string> warnings)
        {
            if (spec == null) return null;

            string type = SimpleJson.GetString(spec, "type");
            if (string.IsNullOrEmpty(type))
            {
                warnings.Add($"Node under {PathOf(parent)} missing `type` — skipped.");
                return null;
            }

            string key = type.Trim().ToLowerInvariant();
            GameObject go = null;

            switch (key)
            {
                case "panel":    go = BuildPanelLike(spec, parent, addImage: true,  layout: null);   break;
                case "image":    go = BuildImage(spec, parent);                                      break;
                case "text":     go = BuildText(spec, parent);                                       break;
                case "button":   go = BuildButton(spec, parent);                                     break;

                case "vstack":
                case "vertical": go = BuildPanelLike(spec, parent, addImage: false, layout: "vertical");   break;
                case "hstack":
                case "horizontal": go = BuildPanelLike(spec, parent, addImage: false, layout: "horizontal"); break;
                case "grid":     go = BuildPanelLike(spec, parent, addImage: false, layout: "grid");  break;

                case "scrolllist":
                case "scroll-list":
                case "scrollview":  go = BuildScrollList(spec, parent, warnings);                    break;

                case "slider":      go = BuildDelegated(spec, parent, UIWidgetOps.CreateSlider, out _); break;
                case "toggle":      go = BuildDelegated(spec, parent, UIWidgetOps.CreateToggle, out _); break;
                case "inputfield":
                case "input-field": go = BuildDelegated(spec, parent, UIWidgetOps.CreateInputField, out _); break;

                case "spacer":      go = BuildSpacer(spec, parent); break;

                case "raw":         go = BuildRaw(spec, parent, warnings); break;

                default:
                    warnings.Add($"Unknown node type '{type}' at {PathOf(parent)} — skipped. Known: Panel, Image, Text, Button, VStack, HStack, Grid, ScrollList, Slider, Toggle, InputField, Spacer, Raw.");
                    return null;
            }

            if (go == null) return null;

            // Recurse children (for container types only — leaf types like Text/Image/Button
            // don't consume children, but we warn rather than silently drop them).
            if (spec.TryGetValue("children", out object childrenObj) && childrenObj is List<object> childList && childList.Count > 0)
            {
                // For ScrollList, children go into the Content node, not the root.
                Transform childParent = go.transform;
                if (key == "scrolllist" || key == "scroll-list" || key == "scrollview")
                {
                    var content = FindDescendantByName(go.transform, "Content");
                    if (content != null) childParent = content;
                }
                if (IsLeaf(key))
                {
                    warnings.Add($"Node '{type}' at {PathOf(go.transform)} does not support children (has {childList.Count}) — ignored.");
                }
                else
                {
                    foreach (var c in childList)
                    {
                        if (c is Dictionary<string, object> childSpec)
                            BuildNode(childSpec, childParent, warnings);
                    }
                }
            }

            return go;
        }

        static bool IsLeaf(string key)
        {
            switch (key)
            {
                case "text":
                case "image":
                case "spacer":
                case "slider":
                case "toggle":
                case "inputfield":
                case "input-field":
                    return true;
                default:
                    return false;  // Button allows a child Text override; container types (Panel, stacks, ScrollList) take children
            }
        }

        // ── Per-type constructors ───────────────────────────────────────

        /// <summary>Build a panel-ish container. Optionally with an Image background and/or a LayoutGroup.</summary>
        static GameObject BuildPanelLike(Dictionary<string, object> spec, Transform parent, bool addImage, string layout)
        {
            string name = SimpleJson.GetString(spec, "name", DefaultNameForLayout(layout) ?? "Panel");
            var go = new GameObject(name, typeof(RectTransform));
            go.transform.SetParent(parent, false);

            if (addImage)
            {
                var img = go.AddComponent<Image>();
                Color color = new Color(0.1f, 0.1f, 0.1f, 0.8f);
                if (spec.TryGetValue("color", out object cRaw) && UIHelpers.TryParseColor(cRaw, out Color c)) color = c;
                img.color = color;
                if (color.a > 0.01f)
                {
                    var uiSprite = AssetDatabase.GetBuiltinExtraResource<Sprite>("UI/Skin/UISprite.psd");
                    if (uiSprite != null) { img.sprite = uiSprite; img.type = Image.Type.Sliced; }
                }
            }

            if (layout != null)
            {
                var laArgs = new Dictionary<string, object>();
                if (spec.TryGetValue("spacing", out object sp)) laArgs["spacing"] = sp;
                if (spec.TryGetValue("padding", out object pad)) laArgs["padding"] = pad;
                if (spec.TryGetValue("childAlignment", out object ca)) laArgs["childAlignment"] = ca;
                if (spec.TryGetValue("controlChildSize", out object ccs)) laArgs["controlChildSize"] = ccs;
                if (spec.TryGetValue("fitContent", out object fc)) laArgs["fitContent"] = fc;
                if (spec.TryGetValue("cellSize", out object cs)) laArgs["cellSize"] = cs;
                UIWidgetOps.AttachLayoutGroup(go, layout, laArgs);
            }

            ApplyRectFromSpec(go, spec);
            Undo.RegisterCreatedObjectUndo(go, $"Build {name}");
            return go;
        }

        static string DefaultNameForLayout(string layout)
        {
            switch (layout)
            {
                case "vertical":   return "VStack";
                case "horizontal": return "HStack";
                case "grid":       return "Grid";
                default:           return null;
            }
        }

        // Helpers below pass `_parentInstanceId` rather than a scene path so
        // widget primitives can SetParent by instance reference. Avoids the
        // ambiguity that happens when two tree siblings share the same name
        // during construction ("VStack" twice under the same parent).

        static GameObject BuildImage(Dictionary<string, object> spec, Transform parent)
        {
            var wArgs = CopyRectArgs(spec);
            wArgs["_parentInstanceId"] = parent.gameObject.GetInstanceID();
            if (spec.TryGetValue("name", out object n)) wArgs["name"] = n;
            if (spec.TryGetValue("sprite", out object s)) wArgs["sprite"] = s;
            if (spec.TryGetValue("color", out object c)) wArgs["color"] = c;
            if (spec.TryGetValue("preserveAspect", out object pa)) wArgs["preserveAspect"] = pa;
            var result = UIWidgetOps.CreateImage(wArgs);
            return result.success ? FindChildByResult(parent, result) : null;
        }

        static GameObject BuildText(Dictionary<string, object> spec, Transform parent)
        {
            var wArgs = CopyRectArgs(spec);
            wArgs["_parentInstanceId"] = parent.gameObject.GetInstanceID();
            if (spec.TryGetValue("name", out object n)) wArgs["name"] = n;
            if (spec.TryGetValue("text", out object t)) wArgs["text"] = t;
            if (spec.TryGetValue("fontSize", out object fs)) wArgs["fontSize"] = fs;
            if (spec.TryGetValue("color", out object c)) wArgs["color"] = c;
            if (spec.TryGetValue("alignment", out object a)) wArgs["alignment"] = a;
            var result = UIWidgetOps.CreateText(wArgs);
            return result.success ? FindChildByResult(parent, result) : null;
        }

        static GameObject BuildButton(Dictionary<string, object> spec, Transform parent)
        {
            var wArgs = CopyRectArgs(spec);
            wArgs["_parentInstanceId"] = parent.gameObject.GetInstanceID();
            if (spec.TryGetValue("name", out object n)) wArgs["name"] = n;
            if (spec.TryGetValue("text", out object t)) wArgs["text"] = t;
            if (spec.TryGetValue("fontSize", out object fs)) wArgs["fontSize"] = fs;
            if (spec.TryGetValue("bgColor", out object bg)) wArgs["bgColor"] = bg;
            if (spec.TryGetValue("textColor", out object tc)) wArgs["textColor"] = tc;
            if (spec.TryGetValue("sprite", out object sp)) wArgs["sprite"] = sp;
            var result = UIWidgetOps.CreateButton(wArgs);
            return result.success ? FindChildByResult(parent, result) : null;
        }

        static GameObject BuildScrollList(Dictionary<string, object> spec, Transform parent, List<string> warnings)
        {
            var wArgs = CopyRectArgs(spec);
            wArgs["_parentInstanceId"] = parent.gameObject.GetInstanceID();
            if (spec.TryGetValue("name", out object n)) wArgs["name"] = n;
            if (spec.TryGetValue("direction", out object d)) wArgs["direction"] = d;
            if (spec.TryGetValue("contentLayout", out object cl)) wArgs["contentLayout"] = cl;
            if (spec.TryGetValue("spacing", out object sp)) wArgs["spacing"] = sp;
            if (spec.TryGetValue("padding", out object pad)) wArgs["padding"] = pad;
            var result = UIWidgetOps.CreateScrollList(wArgs);
            if (!result.success) { warnings.Add($"ScrollList failed: {result.error}"); return null; }
            return FindChildByResult(parent, result);
        }

        static GameObject BuildDelegated(Dictionary<string, object> spec, Transform parent,
            Func<Dictionary<string, object>, CommandResult> createFn, out CommandResult result)
        {
            var wArgs = new Dictionary<string, object>(spec);
            wArgs["_parentInstanceId"] = parent.gameObject.GetInstanceID();
            // Drop children (leaf) so they don't confuse downstream.
            wArgs.Remove("children");
            result = createFn(wArgs);
            return result.success ? FindChildByResult(parent, result) : null;
        }

        static GameObject BuildSpacer(Dictionary<string, object> spec, Transform parent)
        {
            string name = SimpleJson.GetString(spec, "name", "Spacer");
            var go = new GameObject(name, typeof(RectTransform));
            go.transform.SetParent(parent, false);
            // Spacers participate in layout groups via LayoutElement.
            var le = go.AddComponent<LayoutElement>();
            float flex = SimpleJson.GetFloat(spec, "flex", 1f);
            le.flexibleWidth = flex;
            le.flexibleHeight = flex;
            if (spec.TryGetValue("size", out object sizeRaw) && UIHelpers.TryParseSize(sizeRaw, out Vector2 s))
            {
                le.minWidth = s.x;
                le.minHeight = s.y;
            }
            ApplyRectFromSpec(go, spec);
            Undo.RegisterCreatedObjectUndo(go, "Build Spacer");
            return go;
        }

        /// <summary>
        /// Escape hatch: bare GameObject + optional explicit `components`
        /// (array of full-type-name strings). Useful when the schema doesn't
        /// cover your widget and you need to drop in a custom MonoBehaviour.
        /// </summary>
        static GameObject BuildRaw(Dictionary<string, object> spec, Transform parent, List<string> warnings)
        {
            string name = SimpleJson.GetString(spec, "name", "RawNode");
            var go = new GameObject(name, typeof(RectTransform));
            go.transform.SetParent(parent, false);

            if (spec.TryGetValue("components", out object compsRaw) && compsRaw is List<object> comps)
            {
                foreach (var c in comps)
                {
                    string typeName = c as string;
                    if (string.IsNullOrEmpty(typeName)) continue;
                    var t = ComponentOps.ResolveType(typeName);
                    if (t == null)
                    {
                        warnings.Add($"[Raw {name}] Component '{typeName}' not found — skipped.");
                        continue;
                    }
                    if (!typeof(Component).IsAssignableFrom(t))
                    {
                        warnings.Add($"[Raw {name}] '{typeName}' is not a Component — skipped.");
                        continue;
                    }
                    if (go.GetComponent(t) == null) go.AddComponent(t);
                }
            }

            ApplyRectFromSpec(go, spec);
            Undo.RegisterCreatedObjectUndo(go, "Build Raw Node");
            return go;
        }

        // ── Helpers ─────────────────────────────────────────────────────

        /// <summary>
        /// Extract rect-transform-relevant fields from a node spec into a fresh dict
        /// so it can be passed to UIWidgetOps.* handlers, which expect flat args.
        /// </summary>
        static Dictionary<string, object> CopyRectArgs(Dictionary<string, object> spec)
        {
            var result = new Dictionary<string, object>();
            foreach (var key in new[] { "anchor", "size", "pivot", "offset", "anchoredPosition", "offsetMin", "offsetMax" })
            {
                if (spec.TryGetValue(key, out object v)) result[key] = v;
            }
            return result;
        }

        /// <summary>
        /// The widget primitives return a JSON result that carries the new GO's
        /// `instanceId` (preferred — path lookup would ambiguate when two siblings
        /// have the same name, common in tree builds like a column of Buttons).
        /// Falls back to path if instanceId is missing.
        /// </summary>
        static GameObject FindChildByResult(Transform parent, CommandResult result)
        {
            if (string.IsNullOrEmpty(result.resultJson)) return null;
            var parsed = SimpleJson.Deserialize(result.resultJson);
            if (parsed == null) return null;
            if (parsed.TryGetValue("instanceId", out object idRaw))
            {
                int id = (int)UIHelpers.ToFloatSafe(idRaw);
                if (id != 0)
                {
                    var obj = EditorUtility.InstanceIDToObject(id);
                    if (obj is GameObject go) return go;
                    if (obj is Component comp) return comp.gameObject;
                }
            }
            if (parsed.TryGetValue("path", out object pathRaw) && pathRaw is string path && !string.IsNullOrEmpty(path))
                return PropertyOps.FindSceneObject(path, out _);
            return null;
        }

        static Transform FindDescendantByName(Transform root, string name)
        {
            if (root.name == name) return root;
            for (int i = 0; i < root.childCount; i++)
            {
                var found = FindDescendantByName(root.GetChild(i), name);
                if (found != null) return found;
            }
            return null;
        }

        static string PathOf(Transform t)
        {
            return t == null ? "<null>" : PropertyOps.GetScenePath(t.gameObject);
        }

        static void ApplyRectFromSpec(GameObject go, Dictionary<string, object> spec)
        {
            var rt = UIHelpers.EnsureRectTransform(go);
            UIHelpers.ApplyRectTransformArgs(rt, spec);
        }
    }
}
