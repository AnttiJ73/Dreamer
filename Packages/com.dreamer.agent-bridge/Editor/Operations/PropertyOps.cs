using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Reflection;
using UnityEditor;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace Dreamer.AgentBridge
{
    public static class PropertyOps
    {
        /// <summary>
        /// Set a serialized property on a prefab component or scene object component.
        /// Asset target:  { assetPath?: "path", guid?: "guid", componentType?: "TypeName", propertyPath, value }
        /// Scene target:  { sceneObjectPath: "/Main Camera", componentType?: "TypeName", propertyPath, value }
        ///
        /// Value for ObjectReference fields:
        ///   { "assetRef": "Assets/Prefabs/X.prefab" }  — asset reference (auto-resolves typed component refs)
        ///   { "sceneRef": "/Main Camera" }              — scene object reference
        /// </summary>
        public static CommandResult SetProperty(Dictionary<string, object> args)
        {
            string propertyPath = SimpleJson.GetString(args, "propertyPath");
            if (string.IsNullOrEmpty(propertyPath))
                return CommandResult.Fail("'propertyPath' is required.");

            object value = SimpleJson.GetValue(args, "value");
            string componentTypeName = SimpleJson.GetString(args, "componentType");

            // Determine target: scene object or asset
            string sceneObjectPath = SimpleJson.GetString(args, "sceneObjectPath");
            if (!string.IsNullOrEmpty(sceneObjectPath))
            {
                return SetPropertyOnSceneObject(sceneObjectPath, componentTypeName, propertyPath, value);
            }

            string assetPath = AssetOps.ResolveAssetPath(args);
            if (assetPath == null)
                return CommandResult.Fail("Target not found. Provide 'assetPath', 'guid', or 'sceneObjectPath'.");

            string childPath = SimpleJson.GetString(args, "childPath");

            bool isPrefab = assetPath.EndsWith(".prefab", StringComparison.OrdinalIgnoreCase);
            if (isPrefab)
                return SetPropertyOnPrefab(assetPath, componentTypeName, propertyPath, value, childPath);
            else
                return SetPropertyOnAsset(assetPath, propertyPath, value);
        }

        // ── Target: Prefab asset ──

        static CommandResult SetPropertyOnPrefab(string assetPath, string componentTypeName, string propertyPath, object value, string childPath = null)
        {
            var prefabAsset = AssetDatabase.LoadMainAssetAtPath(assetPath) as GameObject;
            if (prefabAsset == null)
                return CommandResult.Fail($"Failed to load prefab: {assetPath}");

            // Navigate to child if specified
            GameObject targetObj = prefabAsset;
            if (!string.IsNullOrEmpty(childPath))
            {
                Transform child = prefabAsset.transform.Find(childPath);
                if (child == null)
                    return CommandResult.Fail($"Child '{childPath}' not found in prefab '{assetPath}'.");
                targetObj = child.gameObject;
            }

            Component target = FindComponent(targetObj, componentTypeName);
            if (target == null)
                return CommandResult.Fail(
                    string.IsNullOrEmpty(componentTypeName)
                        ? $"No components found on '{targetObj.name}'"
                        : $"Component '{componentTypeName}' not found on '{targetObj.name}'");

            return ApplyPropertyAndSave(target, propertyPath, value, assetPath, prefabAsset);
        }

        // ── Target: Scene object ──

        static CommandResult SetPropertyOnSceneObject(string objectPath, string componentTypeName, string propertyPath, object value)
        {
            var go = FindSceneObject(objectPath);
            if (go == null)
                return CommandResult.Fail($"Scene object not found at path: {objectPath}");

            Component target = FindComponent(go, componentTypeName);
            if (target == null)
                return CommandResult.Fail(
                    string.IsNullOrEmpty(componentTypeName)
                        ? $"No components found on scene object: {objectPath}"
                        : $"Component '{componentTypeName}' not found on scene object: {objectPath}");

            var so = new SerializedObject(target);
            var sp = so.FindProperty(propertyPath);
            if (sp == null)
                return CommandResult.Fail($"Property '{propertyPath}' not found on '{target.GetType().Name}'.");

            string error = ApplyValue(sp, value, target);
            if (error != null)
                return CommandResult.Fail(error);

            so.ApplyModifiedPropertiesWithoutUndo();
            EditorUtility.SetDirty(go);

            var json = SimpleJson.Object()
                .Put("set", true)
                .Put("propertyPath", propertyPath)
                .Put("componentType", target.GetType().FullName)
                .Put("sceneObjectPath", objectPath)
                .ToString();

            return CommandResult.Ok(json);
        }

        // ── Target: Generic asset (ScriptableObject, etc.) ──

        static CommandResult SetPropertyOnAsset(string assetPath, string propertyPath, object value)
        {
            var asset = AssetDatabase.LoadMainAssetAtPath(assetPath);
            if (asset == null)
                return CommandResult.Fail($"Failed to load asset: {assetPath}");

            var so = new SerializedObject(asset);
            var sp = so.FindProperty(propertyPath);
            if (sp == null)
                return CommandResult.Fail($"Property '{propertyPath}' not found on '{asset.GetType().Name}'.");

            string error = ApplyValue(sp, value, null);
            if (error != null) return CommandResult.Fail(error);

            so.ApplyModifiedPropertiesWithoutUndo();
            EditorUtility.SetDirty(asset);
            AssetDatabase.SaveAssets();

            var json = SimpleJson.Object()
                .Put("set", true)
                .Put("propertyPath", propertyPath)
                .Put("componentType", asset.GetType().FullName)
                .Put("assetPath", assetPath)
                .ToString();

            return CommandResult.Ok(json);
        }

        // ── Shared helpers ──

        static CommandResult ApplyPropertyAndSave(Component target, string propertyPath, object value, string assetPath, GameObject dirtyTarget)
        {
            var so = new SerializedObject(target);
            var sp = so.FindProperty(propertyPath);
            if (sp == null)
                return CommandResult.Fail($"Property '{propertyPath}' not found on '{target.GetType().Name}'.");

            string error = ApplyValue(sp, value, target);
            if (error != null)
                return CommandResult.Fail(error);

            so.ApplyModifiedPropertiesWithoutUndo();
            EditorUtility.SetDirty(dirtyTarget);
            AssetDatabase.SaveAssets();

            var json = SimpleJson.Object()
                .Put("set", true)
                .Put("propertyPath", propertyPath)
                .Put("componentType", target.GetType().FullName)
                .Put("assetPath", assetPath)
                .ToString();

            return CommandResult.Ok(json);
        }

        static Component FindComponent(GameObject go, string componentTypeName)
        {
            if (!string.IsNullOrEmpty(componentTypeName))
            {
                Type compType = ComponentOps.ResolveType(componentTypeName);
                if (compType == null) return null;
                return go.GetComponent(compType);
            }
            var comps = go.GetComponents<Component>();
            return comps.FirstOrDefault(c => c != null && !(c is Transform)) ?? go.transform;
        }

        /// <summary>Apply a JSON value to a SerializedProperty. Returns error string or null on success.</summary>
        static string ApplyValue(SerializedProperty sp, object value, Component context)
        {
            try
            {
                switch (sp.propertyType)
                {
                    case SerializedPropertyType.Integer:
                        sp.intValue = ToInt(value);
                        return null;

                    case SerializedPropertyType.Float:
                        sp.floatValue = ToFloat(value);
                        return null;

                    case SerializedPropertyType.Boolean:
                        sp.boolValue = ToBool(value);
                        return null;

                    case SerializedPropertyType.String:
                        sp.stringValue = value?.ToString() ?? "";
                        return null;

                    case SerializedPropertyType.Enum:
                        if (value is string enumStr)
                        {
                            for (int i = 0; i < sp.enumNames.Length; i++)
                            {
                                if (sp.enumNames[i].Equals(enumStr, StringComparison.OrdinalIgnoreCase))
                                {
                                    sp.enumValueIndex = i;
                                    return null;
                                }
                            }
                            return $"Invalid enum value '{enumStr}'. Valid values: {string.Join(", ", sp.enumNames)}";
                        }
                        sp.enumValueIndex = ToInt(value);
                        return null;

                    case SerializedPropertyType.Vector2:
                        return SetVector2(sp, value);

                    case SerializedPropertyType.Vector3:
                        return SetVector3(sp, value);

                    case SerializedPropertyType.Vector4:
                        return SetVector4(sp, value);

                    case SerializedPropertyType.Color:
                        return SetColor(sp, value);

                    case SerializedPropertyType.LayerMask:
                        sp.intValue = ToInt(value);
                        return null;

                    case SerializedPropertyType.ObjectReference:
                        return SetObjectReference(sp, value, context);

                    default:
                        return $"Unsupported property type: {sp.propertyType}. Supported: int, float, bool, string, enum, Vector2/3/4, Color, ObjectReference.";
                }
            }
            catch (Exception ex)
            {
                return $"Failed to set value: {ex.Message}";
            }
        }

        // ── ObjectReference handling ──

        /// <summary>
        /// Set an ObjectReference property.
        /// Value can be:
        ///   { "assetRef": "Assets/Prefabs/X.prefab" }  — load asset, auto-resolve typed component refs
        ///   { "sceneRef": "/Main Camera" }              — find scene object
        ///   null                                        — clear the reference
        ///   "Assets/..."                                — shorthand for assetRef
        /// </summary>
        static string SetObjectReference(SerializedProperty sp, object value, Component context)
        {
            // Null → clear reference
            if (value == null)
            {
                sp.objectReferenceValue = null;
                return null;
            }

            // Determine the expected field type via reflection
            Type fieldType = GetFieldType(sp, context);

            // String shorthand
            if (value is string strVal)
            {
                if (string.IsNullOrEmpty(strVal) || strVal == "null")
                {
                    sp.objectReferenceValue = null;
                    return null;
                }
                // Try as asset path
                return SetObjectReferenceFromAsset(sp, strVal, fieldType);
            }

            // Dict with assetRef or sceneRef
            var dict = value as Dictionary<string, object>;
            if (dict == null)
                return "ObjectReference value must be null, a string (asset path), or {\"assetRef\":\"path\"} / {\"sceneRef\":\"path\"}.";

            // Optional childPath — navigate to a child within a prefab or scene object
            string childPath = SimpleJson.GetString(dict, "childPath");

            string assetRef = SimpleJson.GetString(dict, "assetRef");
            if (!string.IsNullOrEmpty(assetRef))
                return SetObjectReferenceFromAsset(sp, assetRef, fieldType, childPath);

            string sceneRef = SimpleJson.GetString(dict, "sceneRef");
            if (!string.IsNullOrEmpty(sceneRef))
                return SetObjectReferenceFromScene(sp, sceneRef, fieldType);

            // "self" — reference a child within the same prefab/object being edited
            string selfChild = SimpleJson.GetString(dict, "selfChild");
            if (!string.IsNullOrEmpty(selfChild) && context != null)
            {
                Transform child = context.transform.Find(selfChild);
                if (child == null)
                    return $"Child '{selfChild}' not found under '{context.gameObject.name}'.";
                return ResolveAndAssign(sp, child.gameObject, fieldType);
            }

            string guidRef = SimpleJson.GetString(dict, "guid");
            if (!string.IsNullOrEmpty(guidRef))
            {
                string path = AssetDatabase.GUIDToAssetPath(guidRef);
                if (string.IsNullOrEmpty(path))
                    return $"No asset found for GUID: {guidRef}";
                return SetObjectReferenceFromAsset(sp, path, fieldType, null);
            }

            return "ObjectReference dict must contain 'assetRef', 'sceneRef', 'selfChild', or 'guid'.";
        }

        static string SetObjectReferenceFromAsset(SerializedProperty sp, string assetPath, Type fieldType, string childPath = null)
        {
            var asset = AssetDatabase.LoadMainAssetAtPath(assetPath);
            if (asset == null)
                return $"Asset not found at: {assetPath}";

            // If childPath specified, navigate into the prefab hierarchy
            if (!string.IsNullOrEmpty(childPath))
            {
                var go = asset as GameObject;
                if (go == null)
                    return $"Asset at '{assetPath}' is not a GameObject — cannot navigate childPath.";

                Transform child = go.transform.Find(childPath);
                if (child == null)
                    return $"Child '{childPath}' not found in prefab '{assetPath}'.";

                return ResolveAndAssign(sp, child.gameObject, fieldType);
            }

            // No childPath — resolve from root
            if (asset is GameObject rootGo)
                return ResolveAndAssign(sp, rootGo, fieldType);

            // Non-GameObject asset (Material, Texture, ScriptableObject, etc.)
            if (fieldType == null || fieldType.IsAssignableFrom(asset.GetType()))
            {
                sp.objectReferenceValue = asset;
                return null;
            }

            // Try sub-assets
            var subAssets = AssetDatabase.LoadAllAssetsAtPath(assetPath);
            foreach (var sub in subAssets)
            {
                if (sub != null && fieldType.IsAssignableFrom(sub.GetType()))
                {
                    sp.objectReferenceValue = sub;
                    return null;
                }
            }

            return $"Asset at '{assetPath}' (type: {asset.GetType().Name}) cannot be assigned to field of type '{fieldType?.Name ?? "unknown"}'.";
        }

        /// <summary>Resolve and assign a GameObject (or one of its components) to a SerializedProperty.</summary>
        static string ResolveAndAssign(SerializedProperty sp, GameObject go, Type fieldType)
        {
            // If field expects a Component type, get it from the GameObject
            if (fieldType != null && typeof(Component).IsAssignableFrom(fieldType))
            {
                var comp = go.GetComponent(fieldType);
                if (comp == null)
                    return $"'{go.name}' does not have a '{fieldType.Name}' component.";
                sp.objectReferenceValue = comp;
                return null;
            }

            // If field expects GameObject or base Object
            if (fieldType == null || fieldType == typeof(GameObject) || fieldType == typeof(UnityEngine.Object))
            {
                sp.objectReferenceValue = go;
                return null;
            }

            // If field expects Transform
            if (fieldType == typeof(Transform) || fieldType == typeof(RectTransform))
            {
                sp.objectReferenceValue = go.transform;
                return null;
            }

            return $"'{go.name}' cannot be assigned to field of type '{fieldType?.Name ?? "unknown"}'.";
        }

        static string SetObjectReferenceFromScene(SerializedProperty sp, string objectPath, Type fieldType)
        {
            var go = FindSceneObject(objectPath);
            if (go == null)
                return $"Scene object not found at path: {objectPath}";

            // If field expects a Component type, get it from the scene object
            if (fieldType != null && typeof(Component).IsAssignableFrom(fieldType))
            {
                var comp = go.GetComponent(fieldType);
                if (comp == null)
                    return $"Scene object '{objectPath}' does not have a '{fieldType.Name}' component.";

                sp.objectReferenceValue = comp;
                return null;
            }

            // If field expects GameObject or UnityEngine.Object
            if (fieldType == null || fieldType == typeof(GameObject) || fieldType == typeof(UnityEngine.Object))
            {
                sp.objectReferenceValue = go;
                return null;
            }

            // If field expects Transform
            if (fieldType == typeof(Transform))
            {
                sp.objectReferenceValue = go.transform;
                return null;
            }

            return $"Scene object '{objectPath}' cannot be assigned to field of type '{fieldType?.Name ?? "unknown"}'.";
        }

        /// <summary>
        /// Determine the C# Type of the field backing a SerializedProperty, using reflection.
        /// </summary>
        static Type GetFieldType(SerializedProperty sp, Component context)
        {
            if (context == null) return null;

            try
            {
                Type type = context.GetType();
                string[] pathParts = sp.propertyPath.Split('.');
                FieldInfo field = null;

                foreach (string part in pathParts)
                {
                    // Skip array element accessors like "Array" and "data[0]"
                    if (part == "Array" || part.StartsWith("data[")) continue;

                    field = type.GetField(part,
                        BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance);
                    if (field == null) return null;
                    type = field.FieldType;
                }

                return field?.FieldType;
            }
            catch
            {
                return null;
            }
        }

        // ── Scene object finder (shared) ──

        public static GameObject FindSceneObject(string path)
        {
            if (string.IsNullOrEmpty(path)) return null;
            if (path.StartsWith("/")) path = path.Substring(1);

            string[] parts = path.Split('/');
            if (parts.Length == 0) return null;

            var scene = SceneManager.GetActiveScene();
            var roots = scene.GetRootGameObjects();
            GameObject current = null;

            foreach (var root in roots)
            {
                if (root.name == parts[0]) { current = root; break; }
            }
            if (current == null) return null;

            for (int i = 1; i < parts.Length; i++)
            {
                Transform child = current.transform.Find(parts[i]);
                if (child == null) return null;
                current = child.gameObject;
            }

            return current;
        }

        // ── Vector / Color helpers ──

        static string SetVector2(SerializedProperty sp, object value)
        {
            var dict = value as Dictionary<string, object>;
            if (dict == null) return "Vector2 expects {\"x\":1,\"y\":2}";
            sp.vector2Value = new Vector2(GetFloatFromDict(dict, "x"), GetFloatFromDict(dict, "y"));
            return null;
        }

        static string SetVector3(SerializedProperty sp, object value)
        {
            var dict = value as Dictionary<string, object>;
            if (dict == null) return "Vector3 expects {\"x\":1,\"y\":2,\"z\":3}";
            sp.vector3Value = new Vector3(GetFloatFromDict(dict, "x"), GetFloatFromDict(dict, "y"), GetFloatFromDict(dict, "z"));
            return null;
        }

        static string SetVector4(SerializedProperty sp, object value)
        {
            var dict = value as Dictionary<string, object>;
            if (dict == null) return "Vector4 expects {\"x\":1,\"y\":2,\"z\":3,\"w\":4}";
            sp.vector4Value = new Vector4(GetFloatFromDict(dict, "x"), GetFloatFromDict(dict, "y"), GetFloatFromDict(dict, "z"), GetFloatFromDict(dict, "w"));
            return null;
        }

        static string SetColor(SerializedProperty sp, object value)
        {
            var dict = value as Dictionary<string, object>;
            if (dict == null) return "Color expects {\"r\":1,\"g\":0,\"b\":0,\"a\":1}";
            sp.colorValue = new Color(GetFloatFromDict(dict, "r", 0f), GetFloatFromDict(dict, "g", 0f), GetFloatFromDict(dict, "b", 0f), GetFloatFromDict(dict, "a", 1f));
            return null;
        }

        // ── Conversion helpers ──

        static float GetFloatFromDict(Dictionary<string, object> dict, string key, float fallback = 0f)
        {
            if (!dict.TryGetValue(key, out object val)) return fallback;
            return ToFloat(val);
        }

        static int ToInt(object val)
        {
            if (val is int i) return i;
            if (val is long l) return (int)l;
            if (val is double d) return (int)d;
            if (val is float f) return (int)f;
            if (val is string s && int.TryParse(s, out int parsed)) return parsed;
            return 0;
        }

        static float ToFloat(object val)
        {
            if (val is double d) return (float)d;
            if (val is float f) return f;
            if (val is int i) return i;
            if (val is long l) return l;
            if (val is string s && float.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out float parsed)) return parsed;
            return 0f;
        }

        static bool ToBool(object val)
        {
            if (val is bool b) return b;
            if (val is int i) return i != 0;
            if (val is long l) return l != 0;
            if (val is string s) return s.Equals("true", StringComparison.OrdinalIgnoreCase);
            return false;
        }
    }
}
