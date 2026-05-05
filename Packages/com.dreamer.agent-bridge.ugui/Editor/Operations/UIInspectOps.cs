using System.Collections.Generic;
using UnityEditor;
using UnityEngine;
using UnityEngine.UI;

namespace Dreamer.AgentBridge
{
    /// <summary>Dump an existing UI hierarchy back to the create-ui-tree JSON schema for round-trip editing.</summary>
    public static class UIInspectOps
    {
        /// <summary>Inspect a UI subtree and return it as create-ui-tree JSON.</summary>
        public static CommandResult InspectUITree(Dictionary<string, object> args)
        {
            string targetPath = SimpleJson.GetString(args, "target");
            if (string.IsNullOrEmpty(targetPath))
                return CommandResult.Fail("`target` is required (the scene path of the UI root to inspect).");
            int depth = (int)SimpleJson.GetFloat(args, "depth", -1f); // -1 = unlimited
            bool includeRaw = SimpleJson.GetBool(args, "includeRaw", true);
            bool includeRect = SimpleJson.GetBool(args, "includeRect", true);

            var go = PropertyOps.FindSceneObject(targetPath, out string err);
            if (go == null) return CommandResult.Fail(err ?? $"Target not found: {targetPath}");

            string tree = InspectNode(go, depth, includeRaw, includeRect);
            return CommandResult.Ok(SimpleJson.Object()
                .Put("inspected", true)
                .Put("rootPath", PropertyOps.GetScenePath(go))
                .PutRaw("tree", tree)
                .ToString());
        }

        static string InspectNode(GameObject go, int remainingDepth, bool includeRaw, bool includeRect)
        {
            var obj = SimpleJson.Object()
                .Put("name", go.name);

            string type = DetectType(go, out Dictionary<string, object> typeProps);
            obj.Put("type", type);

            if (typeProps != null)
            {
                foreach (var kv in typeProps)
                {
                    if (kv.Value is string s) obj.Put(kv.Key, s);
                    else if (kv.Value is int i) obj.Put(kv.Key, i);
                    else if (kv.Value is float f) obj.Put(kv.Key, f);
                    else if (kv.Value is bool b) obj.Put(kv.Key, b);
                    else if (kv.Value is string rawJson && kv.Key.EndsWith("_raw")) obj.PutRaw(kv.Key.Substring(0, kv.Key.Length - 4), rawJson);
                    else if (kv.Value == null) obj.PutNull(kv.Key);
                    else obj.PutRaw(kv.Key, kv.Value.ToString());
                }
            }

            // Preserve unknown components as type-name strings so round-trip through Raw doesn't drop custom MonoBehaviours.
            if (type == "Raw" && includeRaw)
            {
                var comps = SimpleJson.Array();
                foreach (var comp in go.GetComponents<Component>())
                {
                    if (comp == null) continue;
                    if (comp is Transform) continue;
                    comps.Add(comp.GetType().FullName);
                }
                obj.PutRaw("components", comps.ToString());
            }

            if (includeRect)
            {
                var rt = go.GetComponent<RectTransform>();
                if (rt != null)
                {
                    obj.PutRaw("anchorMin", Vector2Json(rt.anchorMin));
                    obj.PutRaw("anchorMax", Vector2Json(rt.anchorMax));
                    obj.PutRaw("pivot", Vector2Json(rt.pivot));
                    obj.PutRaw("sizeDelta", Vector2Json(rt.sizeDelta));
                    obj.PutRaw("anchoredPosition", Vector2Json(rt.anchoredPosition));
                    string preset = DetectAnchorPreset(rt);
                    if (preset != null) obj.Put("anchor", preset);
                }
            }

            if (remainingDepth != 0 && go.transform.childCount > 0)
            {
                // ScrollList children live inside Content, not the root.
                Transform childRoot = go.transform;
                if (type == "ScrollList")
                {
                    var content = FindDescendant(go.transform, "Content");
                    if (content != null) childRoot = content;
                }
                if (IsComposite(type))
                {
                    // Builder reconstructs composite widgets' internals from the top-level node.
                }
                else
                {
                    var children = SimpleJson.Array();
                    int nextDepth = remainingDepth > 0 ? remainingDepth - 1 : -1;
                    for (int i = 0; i < childRoot.childCount; i++)
                    {
                        var child = childRoot.GetChild(i).gameObject;
                        if (type == "ScrollList" && (child.name == "Viewport" || child.name == "Content")) continue;
                        children.AddRaw(InspectNode(child, nextDepth, includeRaw, includeRect));
                    }
                    var childStr = children.ToString();
                    if (childStr != "[]") obj.PutRaw("children", childStr);
                }
            }

            return obj.ToString();
        }

        /// <summary>Widget types whose sub-hierarchy is implicit in the schema — skip child recursion.</summary>
        static bool IsComposite(string type)
        {
            switch (type)
            {
                case "Button":
                case "Slider":
                case "Toggle":
                case "InputField":
                    return true;
                default:
                    return false;
            }
        }

        static string DetectType(GameObject go, out Dictionary<string, object> props)
        {
            props = null;

            if (go.GetComponent<Canvas>() != null)
            {
                props = new Dictionary<string, object>();
                return "Canvas";
            }

            var scroll = go.GetComponent<ScrollRect>();
            if (scroll != null)
            {
                props = new Dictionary<string, object>
                {
                    ["direction"] = scroll.vertical && scroll.horizontal ? "both"
                                   : scroll.horizontal ? "horizontal" : "vertical",
                };
                return "ScrollList";
            }

            var button = go.GetComponent<Button>();
            if (button != null)
            {
                props = new Dictionary<string, object>();
                string label = ExtractChildText(go);
                if (label != null) props["text"] = label;
                return "Button";
            }

            var slider = go.GetComponent<Slider>();
            if (slider != null)
            {
                props = new Dictionary<string, object>
                {
                    ["min"] = slider.minValue,
                    ["max"] = slider.maxValue,
                    ["value"] = slider.value,
                    ["whole"] = slider.wholeNumbers,
                };
                return "Slider";
            }

            var toggle = go.GetComponent<Toggle>();
            if (toggle != null)
            {
                props = new Dictionary<string, object> { ["isOn"] = toggle.isOn };
                string lbl = ExtractChildText(go);
                if (lbl != null) props["label"] = lbl;
                return "Toggle";
            }

            var input = go.GetComponent<InputField>();
            if (input != null)
            {
                props = new Dictionary<string, object> { ["text"] = input.text };
                return "InputField";
            }

            if (go.GetComponent<GridLayoutGroup>() != null)
            {
                props = new Dictionary<string, object>();
                return "Grid";
            }
            if (go.GetComponent<HorizontalLayoutGroup>() != null)
            {
                props = new Dictionary<string, object>();
                return "HStack";
            }
            if (go.GetComponent<VerticalLayoutGroup>() != null)
            {
                props = new Dictionary<string, object>();
                return "VStack";
            }

            // TMP via reflection — add-on doesn't hard-depend on the TMP package.
            var tmpType = UIHelpers.ResolveTMPType();
            if (tmpType != null)
            {
                var tmp = go.GetComponent(tmpType);
                if (tmp != null)
                {
                    props = new Dictionary<string, object>();
                    var tp = tmpType.GetProperty("text");
                    if (tp != null) props["text"] = tp.GetValue(tmp) as string ?? "";
                    var fsp = tmpType.GetProperty("fontSize");
                    if (fsp != null) props["fontSize"] = (float)(fsp.GetValue(tmp) ?? 24f);
                    return "Text";
                }
            }
            var legacyText = go.GetComponent<Text>();
            if (legacyText != null)
            {
                props = new Dictionary<string, object>
                {
                    ["text"] = legacyText.text,
                    ["fontSize"] = (float)legacyText.fontSize,
                };
                return "Text";
            }

            var img = go.GetComponent<Image>();
            if (img != null)
            {
                props = new Dictionary<string, object>
                {
                    ["color_raw"] = ColorJson(img.color),
                };
                if (img.sprite != null)
                {
                    var p = AssetDatabase.GetAssetPath(img.sprite);
                    if (!string.IsNullOrEmpty(p)) props["sprite"] = p;
                }
                return go.transform.childCount > 0 ? "Panel" : "Image";
            }

            props = new Dictionary<string, object>();
            return "Raw";
        }

        static string ExtractChildText(GameObject go)
        {
            var tmpType = UIHelpers.ResolveTMPType();
            for (int i = 0; i < go.transform.childCount; i++)
            {
                var child = go.transform.GetChild(i).gameObject;
                if (tmpType != null)
                {
                    var tmp = child.GetComponent(tmpType);
                    if (tmp != null)
                    {
                        var tp = tmpType.GetProperty("text");
                        if (tp != null) return tp.GetValue(tmp) as string;
                    }
                }
                var lt = child.GetComponent<Text>();
                if (lt != null) return lt.text;
            }
            return null;
        }

        static Transform FindDescendant(Transform root, string name)
        {
            if (root.name == name) return root;
            for (int i = 0; i < root.childCount; i++)
            {
                var found = FindDescendant(root.GetChild(i), name);
                if (found != null) return found;
            }
            return null;
        }

        /// <summary>Try to match the rect's anchorMin/Max/pivot to a known preset name.</summary>
        static string DetectAnchorPreset(RectTransform rt)
        {
            var min = rt.anchorMin;
            var max = rt.anchorMax;
            const float e = 0.001f;
            bool EQ(Vector2 a, Vector2 b) => Mathf.Abs(a.x - b.x) < e && Mathf.Abs(a.y - b.y) < e;

            if (EQ(min, Vector2.zero) && EQ(max, Vector2.one)) return "fill";
            if (EQ(min, new Vector2(0.5f, 0.5f)) && EQ(max, new Vector2(0.5f, 0.5f))) return "center";

            if (EQ(min, new Vector2(0, 1)) && EQ(max, new Vector2(0, 1))) return "top-left";
            if (EQ(min, new Vector2(0.5f, 1)) && EQ(max, new Vector2(0.5f, 1))) return "top";
            if (EQ(min, new Vector2(1, 1)) && EQ(max, new Vector2(1, 1))) return "top-right";
            if (EQ(min, new Vector2(0, 0.5f)) && EQ(max, new Vector2(0, 0.5f))) return "left";
            if (EQ(min, new Vector2(1, 0.5f)) && EQ(max, new Vector2(1, 0.5f))) return "right";
            if (EQ(min, Vector2.zero) && EQ(max, new Vector2(0, 0))) return "bottom-left";
            if (EQ(min, new Vector2(0.5f, 0)) && EQ(max, new Vector2(0.5f, 0))) return "bottom";
            if (EQ(min, new Vector2(1, 0)) && EQ(max, new Vector2(1, 0))) return "bottom-right";

            if (EQ(min, new Vector2(0, 1)) && EQ(max, new Vector2(1, 1))) return "top-stretch";
            if (EQ(min, new Vector2(0, 0.5f)) && EQ(max, new Vector2(1, 0.5f))) return "middle-stretch";
            if (EQ(min, Vector2.zero) && EQ(max, new Vector2(1, 0))) return "bottom-stretch";
            if (EQ(min, Vector2.zero) && EQ(max, new Vector2(0, 1))) return "stretch-left";
            if (EQ(min, new Vector2(0.5f, 0)) && EQ(max, new Vector2(0.5f, 1))) return "stretch-center";
            if (EQ(min, new Vector2(1, 0)) && EQ(max, new Vector2(1, 1))) return "stretch-right";

            return null;
        }

        static string Vector2Json(Vector2 v) =>
            SimpleJson.Object().Put("x", v.x).Put("y", v.y).ToString();

        static string ColorJson(Color c) =>
            SimpleJson.Object().Put("r", c.r).Put("g", c.g).Put("b", c.b).Put("a", c.a).ToString();
    }
}
