using System;
using System.Collections.Generic;
using System.IO;
using UnityEditor;
using UnityEditorInternal;
using UnityEngine;

namespace Dreamer.AgentBridge
{
    /// <summary>
    /// Project Settings authoring. ProjectSettings/*.asset files are not under
    /// Assets/, so AssetDatabase.LoadAssetAtPath returns null on them — they
    /// must be loaded via LoadAllAssetsAtPath which returns the singleton
    /// SerializedObject root. This file holds the convenience commands
    /// (layers/tags/sorting layers/collision matrix/gravity); the generic
    /// SerializedObject editor for arbitrary settings lives elsewhere.
    /// </summary>
    public static class ProjectSettingsOps
    {
        // ─── Common load helpers ──────────────────────────────────────────

        internal static UnityEngine.Object LoadProjectSettingsRoot(string fileName, out string error)
        {
            error = null;
            string path = "ProjectSettings/" + fileName;
            if (!File.Exists(path))
            {
                error = $"ProjectSettings file not found: {path}. Run inspect-project-settings to list available files.";
                return null;
            }
            var objs = AssetDatabase.LoadAllAssetsAtPath(path);
            if (objs == null || objs.Length == 0 || objs[0] == null)
            {
                error = $"Failed to load ProjectSettings asset: {path}. The file exists but Unity returned no main object.";
                return null;
            }
            return objs[0];
        }

        internal static SerializedObject OpenSettings(string fileName, out string error)
        {
            var root = LoadProjectSettingsRoot(fileName, out error);
            if (root == null) return null;
            return new SerializedObject(root);
        }

        static void Save(SerializedObject so)
        {
            so.ApplyModifiedPropertiesWithoutUndo();
            EditorUtility.SetDirty(so.targetObject);
            AssetDatabase.SaveAssets();
        }

        // ─── inspect-project-settings ─────────────────────────────────────

        public static CommandResult InspectProjectSettings(Dictionary<string, object> args)
        {
            string file = SimpleJson.GetString(args, "file");
            if (!string.IsNullOrEmpty(file))
                return InspectOneFile(file);

            // Default summary: tags, layers, sorting layers, physics
            var json = SimpleJson.Object();

            // Layers
            var layersArr = SimpleJson.Array();
            for (int i = 0; i < 32; i++)
            {
                string name = LayerMask.LayerToName(i);
                layersArr.AddRaw(SimpleJson.Object()
                    .Put("index", i)
                    .Put("name", name ?? "")
                    .Put("builtin", i < 8)
                    .ToString());
            }
            json.PutRaw("layers", layersArr.ToString());

            // Tags
            var tagsArr = SimpleJson.Array();
            foreach (var t in InternalEditorUtility.tags) tagsArr.Add(t);
            json.PutRaw("tags", tagsArr.ToString());

            // Sorting layers — UnityEngine.SortingLayer.layers is the public
            // accessor (InternalEditorUtility.sortingLayerNames was removed in
            // Unity 6). Iteration order matches the TagManager order, lowest
            // sort value first.
            var sortingArr = SimpleJson.Array();
            foreach (var s in SortingLayer.layers) sortingArr.Add(s.name);
            json.PutRaw("sortingLayers", sortingArr.ToString());

            // Physics 3D
            var p3d = SimpleJson.Object()
                .PutRaw("gravity", VecToJson(Physics.gravity))
                .Put("defaultContactOffset", Physics.defaultContactOffset)
                .Put("defaultSolverIterations", Physics.defaultSolverIterations)
                .Put("defaultSolverVelocityIterations", Physics.defaultSolverVelocityIterations)
                .PutRaw("disabledCollisionPairs", DisabledCollisionPairs(twoD: false));
            json.PutRaw("physics3D", p3d.ToString());

            // Physics 2D
            var p2d = SimpleJson.Object()
                .PutRaw("gravity", Vec2ToJson(Physics2D.gravity))
                .PutRaw("disabledCollisionPairs", DisabledCollisionPairs(twoD: true));
            json.PutRaw("physics2D", p2d.ToString());

            // List of all .asset files in ProjectSettings/ — agent uses these
            // names with --file or with set-project-setting.
            var filesArr = SimpleJson.Array();
            foreach (var f in Directory.GetFiles("ProjectSettings", "*.asset"))
                filesArr.Add(Path.GetFileName(f));
            json.PutRaw("files", filesArr.ToString());

            return CommandResult.Ok(json.ToString());
        }

        static CommandResult InspectOneFile(string file)
        {
            // Accept short name ("TagManager") or full ("ProjectSettings/TagManager.asset")
            string fileName = NormalizeFileName(file);
            var so = OpenSettings(fileName, out string error);
            if (so == null) return CommandResult.Fail(error);

            var fields = SimpleJson.Array();
            var iter = so.GetIterator();
            iter.NextVisible(true);
            do
            {
                fields.AddRaw(SimpleJson.Object()
                    .Put("path", iter.propertyPath)
                    .Put("type", iter.propertyType.ToString())
                    .Put("displayName", iter.displayName ?? "")
                    .Put("preview", PreviewValue(iter))
                    .ToString());
            } while (iter.NextVisible(false));

            var json = SimpleJson.Object()
                .Put("file", fileName)
                .Put("typeName", so.targetObject.GetType().FullName)
                .PutRaw("fields", fields.ToString())
                .Put("hint", "Use set-project-setting --file " + fileName + " --property <path> --value <JSON> to edit, or inspect-project-setting --file " + fileName + " --property <path> for a deeper subtree.")
                .ToString();
            return CommandResult.Ok(json);
        }

        // ─── Layers ────────────────────────────────────────────────────────

        public static CommandResult SetLayerName(Dictionary<string, object> args)
        {
            int index = SimpleJson.GetInt(args, "index", -1);
            string name = SimpleJson.GetString(args, "name");
            bool force = SimpleJson.GetBool(args, "force", false);

            if (index < 0 || index > 31)
                return CommandResult.Fail($"Layer index must be 0..31; got {index}.");
            if (name == null)
                return CommandResult.Fail("'name' is required (use clear-layer to empty a slot).");
            if (index < 8 && !force)
                return CommandResult.Fail($"Layer {index} is a builtin Unity layer ('{LayerMask.LayerToName(index)}'). Modifying builtins breaks engine assumptions; pass --force to override at your own risk.");

            var so = OpenSettings("TagManager.asset", out string error);
            if (so == null) return CommandResult.Fail(error);
            var layers = so.FindProperty("layers");
            if (layers == null || !layers.isArray)
                return CommandResult.Fail("TagManager.asset has no 'layers' array — Unity layout changed?");

            string previous = layers.GetArrayElementAtIndex(index).stringValue;
            layers.GetArrayElementAtIndex(index).stringValue = name;
            Save(so);

            return CommandResult.Ok(SimpleJson.Object()
                .Put("index", index)
                .Put("previousName", previous)
                .Put("name", name)
                .ToString());
        }

        public static CommandResult ClearLayer(Dictionary<string, object> args)
        {
            int index = SimpleJson.GetInt(args, "index", -1);
            bool force = SimpleJson.GetBool(args, "force", false);

            if (index < 0 || index > 31)
                return CommandResult.Fail($"Layer index must be 0..31; got {index}.");
            if (index < 8 && !force)
                return CommandResult.Fail($"Layer {index} is builtin; pass --force to override.");

            var so = OpenSettings("TagManager.asset", out string error);
            if (so == null) return CommandResult.Fail(error);
            var layers = so.FindProperty("layers");
            string previous = layers.GetArrayElementAtIndex(index).stringValue;
            layers.GetArrayElementAtIndex(index).stringValue = "";
            Save(so);

            return CommandResult.Ok(SimpleJson.Object()
                .Put("index", index)
                .Put("previousName", previous)
                .Put("cleared", true)
                .ToString());
        }

        // ─── Tags ──────────────────────────────────────────────────────────

        public static CommandResult AddTag(Dictionary<string, object> args)
        {
            string name = SimpleJson.GetString(args, "name");
            if (string.IsNullOrEmpty(name))
                return CommandResult.Fail("'name' is required.");

            foreach (var existing in InternalEditorUtility.tags)
            {
                if (string.Equals(existing, name, StringComparison.Ordinal))
                    return CommandResult.Ok(SimpleJson.Object()
                        .Put("name", name)
                        .Put("added", false)
                        .Put("note", "Tag already exists — no change.")
                        .ToString());
            }

            InternalEditorUtility.AddTag(name);
            return CommandResult.Ok(SimpleJson.Object()
                .Put("name", name)
                .Put("added", true)
                .ToString());
        }

        public static CommandResult RemoveTag(Dictionary<string, object> args)
        {
            string name = SimpleJson.GetString(args, "name");
            if (string.IsNullOrEmpty(name))
                return CommandResult.Fail("'name' is required.");

            bool exists = false;
            foreach (var t in InternalEditorUtility.tags)
                if (string.Equals(t, name, StringComparison.Ordinal)) { exists = true; break; }
            if (!exists)
                return CommandResult.Ok(SimpleJson.Object()
                    .Put("name", name)
                    .Put("removed", false)
                    .Put("note", "Tag not found — no change.")
                    .ToString());

            InternalEditorUtility.RemoveTag(name);
            return CommandResult.Ok(SimpleJson.Object()
                .Put("name", name)
                .Put("removed", true)
                .ToString());
        }

        // ─── Sorting Layers ────────────────────────────────────────────────

        public static CommandResult AddSortingLayer(Dictionary<string, object> args)
        {
            string name = SimpleJson.GetString(args, "name");
            if (string.IsNullOrEmpty(name))
                return CommandResult.Fail("'name' is required.");

            var so = OpenSettings("TagManager.asset", out string error);
            if (so == null) return CommandResult.Fail(error);
            var arr = so.FindProperty("m_SortingLayers");
            if (arr == null || !arr.isArray)
                return CommandResult.Fail("TagManager.asset has no 'm_SortingLayers' array — Unity layout changed?");

            // Reject duplicates
            for (int i = 0; i < arr.arraySize; i++)
            {
                var existing = arr.GetArrayElementAtIndex(i);
                var nameProp = existing.FindPropertyRelative("name");
                if (nameProp != null && string.Equals(nameProp.stringValue, name, StringComparison.Ordinal))
                    return CommandResult.Ok(SimpleJson.Object()
                        .Put("name", name)
                        .Put("added", false)
                        .Put("note", "Sorting layer already exists — no change.")
                        .ToString());
            }

            int newIndex = arr.arraySize;
            arr.InsertArrayElementAtIndex(newIndex);
            var newElem = arr.GetArrayElementAtIndex(newIndex);
            var newName = newElem.FindPropertyRelative("name");
            var newId = newElem.FindPropertyRelative("uniqueID");
            if (newName != null) newName.stringValue = name;
            if (newId != null) newId.intValue = (int)(DateTime.UtcNow.Ticks & 0x7FFFFFFF);

            Save(so);

            return CommandResult.Ok(SimpleJson.Object()
                .Put("name", name)
                .Put("added", true)
                .Put("index", newIndex)
                .ToString());
        }

        public static CommandResult RemoveSortingLayer(Dictionary<string, object> args)
        {
            string name = SimpleJson.GetString(args, "name");
            if (string.IsNullOrEmpty(name))
                return CommandResult.Fail("'name' is required.");
            if (string.Equals(name, "Default", StringComparison.Ordinal))
                return CommandResult.Fail("Cannot remove the 'Default' sorting layer.");

            var so = OpenSettings("TagManager.asset", out string error);
            if (so == null) return CommandResult.Fail(error);
            var arr = so.FindProperty("m_SortingLayers");
            if (arr == null || !arr.isArray)
                return CommandResult.Fail("TagManager.asset has no 'm_SortingLayers' array.");

            for (int i = 0; i < arr.arraySize; i++)
            {
                var elem = arr.GetArrayElementAtIndex(i);
                var nameProp = elem.FindPropertyRelative("name");
                if (nameProp != null && string.Equals(nameProp.stringValue, name, StringComparison.Ordinal))
                {
                    arr.DeleteArrayElementAtIndex(i);
                    Save(so);
                    return CommandResult.Ok(SimpleJson.Object()
                        .Put("name", name)
                        .Put("removed", true)
                        .Put("removedAtIndex", i)
                        .ToString());
                }
            }

            return CommandResult.Ok(SimpleJson.Object()
                .Put("name", name)
                .Put("removed", false)
                .Put("note", "Sorting layer not found — no change.")
                .ToString());
        }

        // ─── Layer Collision Matrix ────────────────────────────────────────

        public static CommandResult SetLayerCollision(Dictionary<string, object> args)
        {
            string layerA = SimpleJson.GetString(args, "layerA");
            string layerB = SimpleJson.GetString(args, "layerB");
            bool collide = SimpleJson.GetBool(args, "collide", true);
            bool twoD = SimpleJson.GetBool(args, "twoD", false);

            if (string.IsNullOrEmpty(layerA) || string.IsNullOrEmpty(layerB))
                return CommandResult.Fail("Both 'layerA' and 'layerB' are required (names or numeric indices).");

            int a = ResolveLayer(layerA, out string aErr);
            if (a < 0) return CommandResult.Fail(aErr);
            int b = ResolveLayer(layerB, out string bErr);
            if (b < 0) return CommandResult.Fail(bErr);

            // Unity's API: IgnoreLayerCollision(a, b, ignore). Our --collide flag
            // is the inverse — friendlier to read but means we negate here.
            bool ignore = !collide;
            if (twoD)
            {
                Physics2D.IgnoreLayerCollision(a, b, ignore);
            }
            else
            {
                Physics.IgnoreLayerCollision(a, b, ignore);
            }
            // The IgnoreLayerCollision setters persist automatically (Unity
            // writes the matrix back to DynamicsManager.asset / Physics2DSettings.asset).
            // Still flush AssetDatabase so the change is visible to subsequent reads.
            AssetDatabase.SaveAssets();

            return CommandResult.Ok(SimpleJson.Object()
                .Put("twoD", twoD)
                .Put("layerA", a)
                .Put("layerAName", LayerMask.LayerToName(a))
                .Put("layerB", b)
                .Put("layerBName", LayerMask.LayerToName(b))
                .Put("collide", collide)
                .ToString());
        }

        // ─── Physics gravity ───────────────────────────────────────────────

        public static CommandResult SetPhysicsGravity(Dictionary<string, object> args)
        {
            bool twoD = SimpleJson.GetBool(args, "twoD", false);
            object value;
            if (!args.TryGetValue("value", out value) || value == null)
                return CommandResult.Fail("'value' is required: [x,y,z] (3D) or [x,y] (2D).");

            if (!(value is List<object> v))
                return CommandResult.Fail("'value' must be an array.");

            if (twoD)
            {
                if (v.Count != 2)
                    return CommandResult.Fail($"2D gravity expects 2 components; got {v.Count}.");
                var g = new Vector2(ToFloat(v[0]), ToFloat(v[1]));
                Physics2D.gravity = g;
                AssetDatabase.SaveAssets();
                return CommandResult.Ok(SimpleJson.Object()
                    .Put("twoD", true)
                    .PutRaw("gravity", Vec2ToJson(g))
                    .ToString());
            }
            else
            {
                if (v.Count != 3)
                    return CommandResult.Fail($"3D gravity expects 3 components; got {v.Count}.");
                var g = new Vector3(ToFloat(v[0]), ToFloat(v[1]), ToFloat(v[2]));
                Physics.gravity = g;
                AssetDatabase.SaveAssets();
                return CommandResult.Ok(SimpleJson.Object()
                    .Put("twoD", false)
                    .PutRaw("gravity", VecToJson(g))
                    .ToString());
            }
        }

        // ─── Generic Phase 2 commands ──────────────────────────────────────

        public static CommandResult SetProjectSetting(Dictionary<string, object> args)
        {
            string file = SimpleJson.GetString(args, "file");
            if (string.IsNullOrEmpty(file))
                return CommandResult.Fail("'file' is required (e.g. 'TagManager', 'DynamicsManager', 'ProjectSettings').");
            string fileName = NormalizeFileName(file);

            string propertyPath = SimpleJson.GetString(args, "propertyPath");
            if (string.IsNullOrEmpty(propertyPath))
                return CommandResult.Fail("'propertyPath' is required.");

            object value;
            if (!args.TryGetValue("value", out value))
                return CommandResult.Fail("'value' is required.");

            var so = OpenSettings(fileName, out string error);
            if (so == null) return CommandResult.Fail(error);

            var sp = PropertyOps.FindPropertyWithAlias(so, propertyPath, out string resolved);
            if (sp == null)
                return CommandResult.Fail($"Property '{propertyPath}' not found on {fileName}. Run inspect-project-setting --file {fileName} to list available paths.");

            string applyError = PropertyOps.ApplyValue(sp, value, null);
            if (applyError != null)
                return CommandResult.Fail($"Failed to set '{resolved}': {applyError}");

            Save(so);

            return CommandResult.Ok(SimpleJson.Object()
                .Put("file", fileName)
                .Put("propertyPath", resolved)
                .Put("typeName", so.targetObject.GetType().FullName)
                .Put("set", true)
                .ToString());
        }

        public static CommandResult InspectProjectSetting(Dictionary<string, object> args)
        {
            string file = SimpleJson.GetString(args, "file");
            if (string.IsNullOrEmpty(file))
                return CommandResult.Fail("'file' is required.");
            string fileName = NormalizeFileName(file);

            string propertyPath = SimpleJson.GetString(args, "propertyPath");

            var so = OpenSettings(fileName, out string error);
            if (so == null) return CommandResult.Fail(error);

            // No propertyPath → return the full top-level field listing
            if (string.IsNullOrEmpty(propertyPath))
                return InspectOneFile(fileName);

            var sp = PropertyOps.FindPropertyWithAlias(so, propertyPath, out string resolved);
            if (sp == null)
                return CommandResult.Fail($"Property '{propertyPath}' not found on {fileName}.");

            int depth = SimpleJson.GetInt(args, "depth", 3);
            var json = SimpleJson.Object()
                .Put("file", fileName)
                .Put("propertyPath", resolved)
                .PutRaw("value", SerializePropertyTree(sp, depth));
            return CommandResult.Ok(json.ToString());
        }

        // ─── Helpers ───────────────────────────────────────────────────────

        static string NormalizeFileName(string file)
        {
            // Accept "TagManager", "TagManager.asset", "ProjectSettings/TagManager.asset"
            string f = file.Trim().Replace("\\", "/");
            if (f.StartsWith("ProjectSettings/", StringComparison.OrdinalIgnoreCase))
                f = f.Substring("ProjectSettings/".Length);
            if (!f.EndsWith(".asset", StringComparison.OrdinalIgnoreCase))
                f += ".asset";
            return f;
        }

        static int ResolveLayer(string nameOrIndex, out string error)
        {
            error = null;
            if (string.IsNullOrEmpty(nameOrIndex)) { error = "Layer name/index is empty."; return -1; }
            if (int.TryParse(nameOrIndex, System.Globalization.NumberStyles.Integer, System.Globalization.CultureInfo.InvariantCulture, out int idx))
            {
                if (idx < 0 || idx > 31) { error = $"Layer index out of range (0..31): {idx}"; return -1; }
                return idx;
            }
            int byName = LayerMask.NameToLayer(nameOrIndex);
            if (byName < 0)
            {
                error = $"Layer not found: '{nameOrIndex}'. Run inspect-project-settings to list current layer names.";
                return -1;
            }
            return byName;
        }

        static string DisabledCollisionPairs(bool twoD)
        {
            var arr = SimpleJson.Array();
            for (int i = 0; i < 32; i++)
            {
                if (string.IsNullOrEmpty(LayerMask.LayerToName(i))) continue;
                for (int j = i; j < 32; j++)
                {
                    if (string.IsNullOrEmpty(LayerMask.LayerToName(j))) continue;
                    bool ignored = twoD
                        ? Physics2D.GetIgnoreLayerCollision(i, j)
                        : Physics.GetIgnoreLayerCollision(i, j);
                    if (ignored)
                    {
                        arr.AddRaw(SimpleJson.Object()
                            .Put("a", i)
                            .Put("aName", LayerMask.LayerToName(i))
                            .Put("b", j)
                            .Put("bName", LayerMask.LayerToName(j))
                            .ToString());
                    }
                }
            }
            return arr.ToString();
        }

        static float ToFloat(object o)
        {
            if (o is double d) return (float)d;
            if (o is float f) return f;
            if (o is long l) return l;
            if (o is int i) return i;
            if (o is string s && float.TryParse(s, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out float r)) return r;
            return 0f;
        }

        static string VecToJson(Vector3 v)
        {
            return $"[{v.x.ToString(System.Globalization.CultureInfo.InvariantCulture)},{v.y.ToString(System.Globalization.CultureInfo.InvariantCulture)},{v.z.ToString(System.Globalization.CultureInfo.InvariantCulture)}]";
        }

        static string Vec2ToJson(Vector2 v)
        {
            return $"[{v.x.ToString(System.Globalization.CultureInfo.InvariantCulture)},{v.y.ToString(System.Globalization.CultureInfo.InvariantCulture)}]";
        }

        static string PreviewValue(SerializedProperty sp)
        {
            try
            {
                switch (sp.propertyType)
                {
                    case SerializedPropertyType.Boolean: return sp.boolValue ? "true" : "false";
                    case SerializedPropertyType.Integer: return sp.intValue.ToString(System.Globalization.CultureInfo.InvariantCulture);
                    case SerializedPropertyType.Float: return sp.floatValue.ToString(System.Globalization.CultureInfo.InvariantCulture);
                    case SerializedPropertyType.String: return sp.stringValue ?? "";
                    case SerializedPropertyType.Enum: return sp.enumValueIndex >= 0 && sp.enumNames != null && sp.enumValueIndex < sp.enumNames.Length ? sp.enumNames[sp.enumValueIndex] : sp.enumValueIndex.ToString();
                    case SerializedPropertyType.Vector2: return Vec2ToJson(sp.vector2Value);
                    case SerializedPropertyType.Vector3: return VecToJson(sp.vector3Value);
                    case SerializedPropertyType.Color: { var c = sp.colorValue; return $"[{c.r},{c.g},{c.b},{c.a}]"; }
                    case SerializedPropertyType.ObjectReference: return sp.objectReferenceValue != null ? sp.objectReferenceValue.name : "null";
                    case SerializedPropertyType.Generic: return sp.isArray ? $"array[{sp.arraySize}]" : "(struct)";
                    default: return $"<{sp.propertyType}>";
                }
            }
            catch { return "<unreadable>"; }
        }

        static string SerializePropertyTree(SerializedProperty sp, int depth)
        {
            if (sp.isArray && sp.propertyType != SerializedPropertyType.String)
            {
                var arr = SimpleJson.Array();
                int max = Math.Min(sp.arraySize, 64);
                for (int i = 0; i < max; i++)
                {
                    var elem = sp.GetArrayElementAtIndex(i);
                    arr.AddRaw(SerializePropertyTree(elem, depth - 1));
                }
                if (sp.arraySize > max)
                    arr.Add($"... +{sp.arraySize - max} more");
                return arr.ToString();
            }

            if (sp.propertyType == SerializedPropertyType.Generic && depth > 0)
            {
                var obj = SimpleJson.Object();
                var copy = sp.Copy();
                var end = sp.GetEndProperty();
                bool first = true;
                bool ok = copy.NextVisible(true);
                while (ok && !SerializedProperty.EqualContents(copy, end))
                {
                    if (first) first = false;
                    obj.PutRaw(copy.name, SerializePropertyTree(copy, depth - 1));
                    ok = copy.NextVisible(false);
                }
                return obj.ToString();
            }

            return JsonOfLeaf(sp);
        }

        static string JsonOfLeaf(SerializedProperty sp)
        {
            try
            {
                switch (sp.propertyType)
                {
                    case SerializedPropertyType.Boolean: return sp.boolValue ? "true" : "false";
                    case SerializedPropertyType.Integer: return sp.intValue.ToString(System.Globalization.CultureInfo.InvariantCulture);
                    case SerializedPropertyType.Float: return sp.floatValue.ToString(System.Globalization.CultureInfo.InvariantCulture);
                    case SerializedPropertyType.String: return SimpleJson.Serialize(sp.stringValue ?? "");
                    case SerializedPropertyType.Enum: return SimpleJson.Serialize(sp.enumValueIndex >= 0 && sp.enumNames != null && sp.enumValueIndex < sp.enumNames.Length ? sp.enumNames[sp.enumValueIndex] : sp.enumValueIndex.ToString());
                    case SerializedPropertyType.Vector2: return Vec2ToJson(sp.vector2Value);
                    case SerializedPropertyType.Vector3: return VecToJson(sp.vector3Value);
                    case SerializedPropertyType.Color: { var c = sp.colorValue; return $"[{c.r},{c.g},{c.b},{c.a}]"; }
                    case SerializedPropertyType.ObjectReference: return SimpleJson.Serialize(sp.objectReferenceValue != null ? sp.objectReferenceValue.name : "null");
                    default: return SimpleJson.Serialize($"<{sp.propertyType}>");
                }
            }
            catch { return SimpleJson.Serialize("<unreadable>"); }
        }
    }
}
