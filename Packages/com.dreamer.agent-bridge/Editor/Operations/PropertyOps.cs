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
        ///
        /// Array / List&lt;T&gt; handling:
        ///   propertyPath "entries"            — value is the full replacement (pass [] to clear)
        ///   propertyPath "entries[24]"        — target element N directly (bracket shorthand for
        ///                                       Unity's "entries.Array.data[24]")
        ///   value { "_size": N, "24": val }   — resize + sparse assignment (append-safe: leaves
        ///                                       existing elements at other indices untouched)
        /// </summary>
        public static CommandResult SetProperty(Dictionary<string, object> args)
        {
            string propertyPath = SimpleJson.GetString(args, "propertyPath");
            if (string.IsNullOrEmpty(propertyPath))
                return CommandResult.Fail("'propertyPath' is required.");

            // Common pitfall: agents try to rename a GameObject by setting m_Name
            // on it — but m_Name lives on the GameObject anchor, not a Component,
            // and set-property only routes through Components. Catch that early
            // with a directive error instead of returning the cryptic "Property
            // 'm_Name' not found on '<ComponentType>'".
            if (string.Equals(propertyPath, "m_Name", StringComparison.Ordinal) ||
                string.Equals(propertyPath, "name",   StringComparison.Ordinal))
            {
                return CommandResult.Fail(
                    "set-property cannot rename a GameObject — m_Name lives on the GameObject anchor, not a component. " +
                    "Use `./bin/dreamer rename --scene-object <path> --name <new-name> --wait` " +
                    "(or for a prefab: `--asset <prefab.prefab> [--child-path <subpath>] --name <new-name>`).");
            }

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
            var go = FindSceneObject(objectPath, out string findError);
            if (go == null)
                return CommandResult.Fail(findError ?? $"Scene object not found at path: {objectPath}");

            Component target = FindComponent(go, componentTypeName);
            if (target == null)
                return CommandResult.Fail(
                    string.IsNullOrEmpty(componentTypeName)
                        ? $"No components found on scene object: {objectPath}"
                        : $"Component '{componentTypeName}' not found on scene object: {objectPath}");

            var so = new SerializedObject(target);
            var sp = FindPropertyWithAlias(so, propertyPath, out string resolvedPath);
            if (sp == null)
                return CommandResult.Fail(PropertyNotFoundMessage(target.GetType().Name, propertyPath));

            string error = ApplyValue(sp, value, target);
            if (error != null)
                return CommandResult.Fail(error);

            so.ApplyModifiedPropertiesWithoutUndo();
            EditorUtility.SetDirty(go);

            var json = SimpleJson.Object()
                .Put("set", true)
                .Put("propertyPath", propertyPath)
                .Put("resolvedPath", resolvedPath)
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
            var sp = FindPropertyWithAlias(so, propertyPath, out string resolvedPath);
            if (sp == null)
                return CommandResult.Fail(PropertyNotFoundMessage(asset.GetType().Name, propertyPath));

            string error = ApplyValue(sp, value, null);
            if (error != null) return CommandResult.Fail(error);

            so.ApplyModifiedPropertiesWithoutUndo();
            EditorUtility.SetDirty(asset);
            AssetDatabase.SaveAssets();

            var json = SimpleJson.Object()
                .Put("set", true)
                .Put("propertyPath", propertyPath)
                .Put("resolvedPath", resolvedPath)
                .Put("componentType", asset.GetType().FullName)
                .Put("assetPath", assetPath)
                .ToString();

            return CommandResult.Ok(json);
        }

        // ── Shared helpers ──

        static CommandResult ApplyPropertyAndSave(Component target, string propertyPath, object value, string assetPath, GameObject dirtyTarget)
        {
            var so = new SerializedObject(target);
            var sp = FindPropertyWithAlias(so, propertyPath, out string resolvedPath);
            if (sp == null)
                return CommandResult.Fail(PropertyNotFoundMessage(target.GetType().Name, propertyPath));

            string error = ApplyValue(sp, value, target);
            if (error != null)
                return CommandResult.Fail(error);

            so.ApplyModifiedPropertiesWithoutUndo();
            EditorUtility.SetDirty(dirtyTarget);
            AssetDatabase.SaveAssets();

            var json = SimpleJson.Object()
                .Put("set", true)
                .Put("propertyPath", propertyPath)
                .Put("resolvedPath", resolvedPath)
                .Put("componentType", target.GetType().FullName)
                .Put("assetPath", assetPath)
                .ToString();

            return CommandResult.Ok(json);
        }

        /// <summary>
        /// Resolve a property path, tolerating two common user-friendly shorthands:
        ///
        /// (A) Unity built-in m_-prefix convention. Built-in components (Transform,
        /// SpriteRenderer, Collider, Behaviour subclasses, etc.) expose serialized
        /// fields as "m_Pascal" even though the public C# property is "camelCase"
        /// — so <c>--property sprite</c> hits "Property not found" unless spelled
        /// as <c>m_Sprite</c>. User-defined [SerializeField] fields keep their
        /// declared name and resolve via the primary lookup unchanged.
        ///
        /// (B) Bracket index shorthand. Unity's SerializedProperty path for an
        /// array element is <c>entries.Array.data[24]</c>, but agents reasonably
        /// write <c>entries[24]</c>. Without rewriting, FindProperty returns null
        /// and the agent falls back to replacing the whole array. We translate
        /// <c>[N]</c> segments to <c>.Array.data[N]</c> after the direct-lookup
        /// fails.
        ///
        /// Candidate order (first match wins):
        ///   1. Path as given
        ///   2. m_-prefixed first segment
        ///   3. Bracket-rewritten: <c>[N]</c> → <c>.Array.data[N]</c>
        ///   4. Both transformations combined
        /// </summary>
        static SerializedProperty FindPropertyWithAlias(SerializedObject so, string propertyPath, out string resolvedPath)
        {
            resolvedPath = propertyPath;
            if (so == null || string.IsNullOrEmpty(propertyPath)) return null;

            foreach (var candidate in GetPropertyPathCandidates(propertyPath))
            {
                var sp = so.FindProperty(candidate);
                if (sp != null)
                {
                    resolvedPath = candidate;
                    return sp;
                }
            }
            return null;
        }

        /// <summary>
        /// Enumerate the resolution candidates for a user-supplied property path.
        /// Ordering matters: earlier candidates are preferred and represent closer
        /// matches to what the user wrote.
        /// </summary>
        static IEnumerable<string> GetPropertyPathCandidates(string path)
        {
            yield return path;

            string withMPrefix = MaybeAddMPrefix(path);
            if (withMPrefix != path) yield return withMPrefix;

            string bracketRewritten = RewriteBracketIndices(path);
            if (bracketRewritten != path)
            {
                yield return bracketRewritten;
                string both = MaybeAddMPrefix(bracketRewritten);
                if (both != bracketRewritten) yield return both;
            }
        }

        /// <summary>
        /// Prefix the first segment with "m_" + UpperFirst if it looks like a
        /// bare camelCase public-property name. Idempotent on already-prefixed
        /// paths and on paths starting with a non-letter.
        /// </summary>
        static string MaybeAddMPrefix(string path)
        {
            int boundary = IndexOfPathBoundary(path);
            string firstSeg = boundary < 0 ? path : path.Substring(0, boundary);
            string rest = boundary < 0 ? "" : path.Substring(boundary);
            if (firstSeg.StartsWith("m_", StringComparison.Ordinal)) return path;
            if (firstSeg.Length == 0 || !char.IsLower(firstSeg[0])) return path;
            return "m_" + char.ToUpperInvariant(firstSeg[0]) + firstSeg.Substring(1) + rest;
        }

        /// <summary>
        /// Rewrite user-friendly <c>[N]</c> array-index segments to Unity's
        /// canonical <c>.Array.data[N]</c>. <c>entries[24].count</c> becomes
        /// <c>entries.Array.data[24].count</c>. Paths that don't contain bracket
        /// indices are returned unchanged.
        /// </summary>
        static string RewriteBracketIndices(string path)
        {
            return System.Text.RegularExpressions.Regex.Replace(
                path, @"\[(\d+)\]", ".Array.data[$1]");
        }

        /// <summary>
        /// Find the first path boundary char ('.' or '[') or -1 if the path is a single identifier.
        /// </summary>
        static int IndexOfPathBoundary(string path)
        {
            for (int i = 0; i < path.Length; i++)
            {
                char c = path[i];
                if (c == '.' || c == '[') return i;
            }
            return -1;
        }

        /// <summary>
        /// Build a helpful "property not found" error. Hints at the m_-prefix alias
        /// convention when the user likely tried a bare C# property name on a built-in
        /// Unity component.
        /// </summary>
        static string PropertyNotFoundMessage(string typeName, string propertyPath)
        {
            int boundary = IndexOfPathBoundary(propertyPath);
            string firstSeg = boundary < 0 ? propertyPath : propertyPath.Substring(0, boundary);

            bool looksCamelCase = firstSeg.Length > 0 && char.IsLower(firstSeg[0])
                && !firstSeg.StartsWith("m_", StringComparison.Ordinal);

            string hint = looksCamelCase
                ? $" (Unity built-in components use 'm_<Pascal>' names — tried 'm_{char.ToUpperInvariant(firstSeg[0]) + firstSeg.Substring(1)}' automatically, that also failed. Verify the field exists via `./bin/dreamer inspect --component {typeName}`.)"
                : "";
            return $"Property '{propertyPath}' not found on '{typeName}'.{hint}";
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
                // Arrays and Lists (including struct arrays) — handle before the type switch,
                // since Unity reports propertyType=Generic for array/list roots. IMPORTANT:
                // SerializedProperty.isArray also returns true for strings (char arrays in
                // Unity's serialization model), so exclude String explicitly — we want it
                // handled as a leaf value via the switch below.
                if (sp.isArray && sp.propertyType != SerializedPropertyType.String)
                    return ApplyArray(sp, value, context);

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

                    case SerializedPropertyType.Generic:
                        // Non-array struct (e.g. a nested [Serializable] class or value type).
                        return ApplyStruct(sp, value, context);

                    default:
                        return $"Unsupported property type: {sp.propertyType}. Supported: int, float, bool, string, enum, Vector2/3/4, Color, LayerMask, ObjectReference, arrays/lists, nested structs.";
                }
            }
            catch (Exception ex)
            {
                return $"Failed to set value: {ex.Message}";
            }
        }

        /// <summary>
        /// Apply a JSON array to an array/list SerializedProperty.
        /// Value formats:
        ///   null or missing          → clear (arraySize = 0)
        ///   [v1, v2, ...]            → resize and assign each element (recursive ApplyValue)
        ///   { "_size": N }           → resize only, leave existing element values
        ///   { "_size": N, "0": v, "3": v } → resize + sparse index assignment (useful for large arrays)
        /// </summary>
        static string ApplyArray(SerializedProperty sp, object value, Component context)
        {
            if (value == null)
            {
                sp.arraySize = 0;
                return null;
            }

            if (value is List<object> list)
            {
                sp.arraySize = list.Count;
                for (int i = 0; i < list.Count; i++)
                {
                    var elemSp = sp.GetArrayElementAtIndex(i);
                    if (elemSp == null)
                        return $"Failed to access array element [{i}] of '{sp.propertyPath}'.";
                    string err = ApplyValue(elemSp, list[i], context);
                    if (err != null) return $"[{i}] {err}";
                }
                return null;
            }

            if (value is Dictionary<string, object> dict)
            {
                // Sparse/size-only form
                if (dict.TryGetValue("_size", out object sizeVal))
                    sp.arraySize = ToInt(sizeVal);

                foreach (var kv in dict)
                {
                    if (kv.Key == "_size") continue;
                    if (!int.TryParse(kv.Key, out int idx))
                        return $"Array key '{kv.Key}' is not a valid index (expected integer or '_size').";
                    if (idx < 0 || idx >= sp.arraySize)
                        return $"Array index [{idx}] out of range (size={sp.arraySize}). Provide '_size' or use a full array value.";
                    var elemSp = sp.GetArrayElementAtIndex(idx);
                    string err = ApplyValue(elemSp, kv.Value, context);
                    if (err != null) return $"[{idx}] {err}";
                }
                return null;
            }

            return $"Array property '{sp.propertyPath}' expects a JSON array or {{\"_size\":N, ...}} object (got {value.GetType().Name}).";
        }

        /// <summary>
        /// Apply a JSON object to a struct/nested-serializable SerializedProperty.
        /// Each key names a field on the struct; values recurse through ApplyValue.
        /// An empty object {} leaves the struct unchanged.
        /// </summary>
        static string ApplyStruct(SerializedProperty sp, object value, Component context)
        {
            if (value == null)
                return $"Struct property '{sp.propertyPath}' cannot be set to null. Use {{}} to leave unchanged, or set individual fields.";

            var dict = value as Dictionary<string, object>;
            if (dict == null)
                return $"Struct property '{sp.propertyPath}' expects a JSON object with field names (got {value.GetType().Name}).";

            foreach (var kv in dict)
            {
                var childSp = sp.FindPropertyRelative(kv.Key);
                if (childSp == null)
                    return $"Field '{kv.Key}' not found in struct at '{sp.propertyPath}'.";
                string err = ApplyValue(childSp, kv.Value, context);
                if (err != null) return $".{kv.Key}: {err}";
            }
            return null;
        }

        // ── ObjectReference handling ──

        /// <summary>
        /// Set an ObjectReference property.
        /// Value can be:
        ///   null                                        — clear the reference
        ///   "Assets/..."                                — shorthand for assetRef
        ///   { "assetRef": "Assets/Prefabs/X.prefab" }   — load asset; auto-resolves Component refs by field type
        ///   { "sceneRef": "/Main Camera" }              — find scene object (supports recursive search)
        ///   { "self": true }                            — same GameObject as the component being edited
        ///   { "selfChild": "Child/Grandchild" }         — navigate within the current prefab/scene object
        ///   { "guid": "abc..." }                        — resolve asset by GUID
        ///
        /// Optional modifiers (combinable with any source):
        ///   "component": "TypeName"   — pick a specific component (needed for base-class fields like
        ///                                Behaviour[], Component[], or when multiple components match)
        ///   "childPath": "Child"      — (assetRef only) navigate into the prefab after loading
        ///   "subAsset": "Name"        — (assetRef/guid only) select a specific sub-asset by name
        ///                                (e.g. a Sprite inside a Texture2D imported as Multiple).
        ///                                Without this hint, Dreamer auto-probes sub-assets when
        ///                                the main asset type doesn't match the field.
        /// </summary>
        static string SetObjectReference(SerializedProperty sp, object value, Component context)
        {
            // Null → clear reference
            if (value == null)
            {
                sp.objectReferenceValue = null;
                return null;
            }

            // Determine the expected field type via reflection (unwraps array/list element types).
            Type fieldType = GetFieldType(sp, context);

            // String shorthand
            if (value is string strVal)
            {
                if (string.IsNullOrEmpty(strVal) || strVal == "null")
                {
                    sp.objectReferenceValue = null;
                    return null;
                }
                return SetObjectReferenceFromAsset(sp, strVal, fieldType, null, null, null);
            }

            var dict = value as Dictionary<string, object>;
            if (dict == null)
                return "ObjectReference value must be null, a string (asset path), or an object with one of: assetRef/sceneRef/self/selfChild/guid.";

            // Optional component-type override — essential for base-class fields (Behaviour[], Component[], etc.)
            Type componentHint = null;
            string componentOverride = SimpleJson.GetString(dict, "component");
            if (!string.IsNullOrEmpty(componentOverride))
            {
                componentHint = ComponentOps.ResolveType(componentOverride);
                if (componentHint == null)
                    return $"Component type '{componentOverride}' not found. Use the full type name (e.g. 'Namespace.TypeName').";
                if (!typeof(Component).IsAssignableFrom(componentHint))
                    return $"Type '{componentOverride}' is not a Component.";
            }

            string childPath = SimpleJson.GetString(dict, "childPath");
            string subAssetName = SimpleJson.GetString(dict, "subAsset");

            string assetRef = SimpleJson.GetString(dict, "assetRef");
            if (!string.IsNullOrEmpty(assetRef))
                return SetObjectReferenceFromAsset(sp, assetRef, fieldType, childPath, componentHint, subAssetName);

            string sceneRef = SimpleJson.GetString(dict, "sceneRef");
            if (!string.IsNullOrEmpty(sceneRef))
                return SetObjectReferenceFromScene(sp, sceneRef, fieldType, componentHint);

            // "self": true — reference the same GameObject as the component being edited.
            // Combined with "component", picks a sibling component by type.
            if (SimpleJson.GetBool(dict, "self") && context != null)
                return ResolveAndAssign(sp, context.gameObject, fieldType, componentHint);

            // "selfChild" — navigate to a descendant of the current prefab/object being edited.
            string selfChild = SimpleJson.GetString(dict, "selfChild");
            if (!string.IsNullOrEmpty(selfChild) && context != null)
            {
                Transform child = context.transform.Find(selfChild);
                if (child == null)
                    return $"Child '{selfChild}' not found under '{context.gameObject.name}'.";
                return ResolveAndAssign(sp, child.gameObject, fieldType, componentHint);
            }

            string guidRef = SimpleJson.GetString(dict, "guid");
            if (!string.IsNullOrEmpty(guidRef))
            {
                string path = AssetDatabase.GUIDToAssetPath(guidRef);
                if (string.IsNullOrEmpty(path))
                    return $"No asset found for GUID: {guidRef}";
                return SetObjectReferenceFromAsset(sp, path, fieldType, childPath, componentHint, subAssetName);
            }

            return "ObjectReference dict must contain one of: 'assetRef', 'sceneRef', 'self', 'selfChild', 'guid'. Optional: 'component' (type override), 'childPath' (with assetRef/guid), 'subAsset' (pick a named sub-asset like a Sprite inside a Texture2D).";
        }

        /// <summary>
        /// Resolve an ObjectReference from an asset path. Handles the common
        /// "main asset is a Texture2D but the field wants the Sprite sub-asset"
        /// pattern (SpriteRenderer.m_Sprite) — reflection can't determine the
        /// expected field type for Unity built-in components since the C#
        /// classes are mostly marshaling wrappers with no declared managed
        /// fields, so we need a probe-and-verify fallback.
        /// </summary>
        static string SetObjectReferenceFromAsset(SerializedProperty sp, string assetPath, Type fieldType, string childPath, Type componentHint, string subAssetName)
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

                return ResolveAndAssign(sp, child.gameObject, fieldType, componentHint);
            }

            // No childPath — resolve from root
            if (asset is GameObject rootGo)
                return ResolveAndAssign(sp, rootGo, fieldType, componentHint);

            // Explicit sub-asset name — authoritative path for Multiple-mode sprite atlases etc.
            if (!string.IsNullOrEmpty(subAssetName))
            {
                var subs = AssetDatabase.LoadAllAssetsAtPath(assetPath);
                var named = System.Array.Find(subs, s => s != null && s.name == subAssetName);
                if (named == null)
                {
                    var available = string.Join(", ",
                        System.Array.ConvertAll(
                            System.Array.FindAll(subs, s => s != null),
                            s => $"{s.name}({s.GetType().Name})"));
                    return $"Sub-asset '{subAssetName}' not found at '{assetPath}'. Available: {(string.IsNullOrEmpty(available) ? "(none)" : available)}.";
                }
                if (!TryAssignAndVerify(sp, named))
                    return $"Unity rejected '{named.name}' ({named.GetType().Name}) for '{sp.propertyPath}' — type mismatch.";
                return null;
            }

            // Non-GameObject asset (Material, Texture, ScriptableObject, etc.). Component hint not
            // applicable here — only relevant when resolving against a GameObject.
            Type expected = componentHint ?? fieldType;

            // Known expected type — assign directly if compatible, otherwise scan sub-assets.
            if (expected != null)
            {
                if (expected.IsAssignableFrom(asset.GetType()))
                {
                    sp.objectReferenceValue = asset;
                    return null;
                }

                var subAssets = AssetDatabase.LoadAllAssetsAtPath(assetPath);
                foreach (var sub in subAssets)
                {
                    if (sub != null && expected.IsAssignableFrom(sub.GetType()))
                    {
                        sp.objectReferenceValue = sub;
                        return null;
                    }
                }
                return $"Asset at '{assetPath}' (type: {asset.GetType().Name}) cannot be assigned to field of type '{expected.Name}'. No matching sub-asset found.";
            }

            // Expected type UNKNOWN. This happens for Unity built-in component fields like
            // SpriteRenderer.m_Sprite — reflection returns null because the managed class
            // has no declared field. Probe Unity directly: try the main asset, verify the
            // assign stuck (Unity silently drops wrong-type assignments to null). If that
            // fails, scan sub-assets and try each one. Auto-pick when exactly one accepts.
            if (TryAssignAndVerify(sp, asset))
                return null;

            var allSubs = AssetDatabase.LoadAllAssetsAtPath(assetPath);
            UnityEngine.Object accepted = null;
            int acceptedCount = 0;
            foreach (var sub in allSubs)
            {
                if (sub == null || ReferenceEquals(sub, asset)) continue;
                if (TryAssignAndVerify(sp, sub))
                {
                    accepted = sub;
                    acceptedCount++;
                }
            }

            if (acceptedCount == 1)
            {
                sp.objectReferenceValue = accepted;
                return null;
            }

            // Reset to avoid leaving a probe value in place.
            sp.objectReferenceValue = null;

            if (acceptedCount == 0)
            {
                var allNames = string.Join(", ",
                    System.Array.ConvertAll(
                        System.Array.FindAll(allSubs, s => s != null),
                        s => $"{s.name}({s.GetType().Name})"));
                return $"No asset or sub-asset at '{assetPath}' was accepted by '{sp.propertyPath}'. Main: {asset.GetType().Name}. Candidates: {(string.IsNullOrEmpty(allNames) ? "(none)" : allNames)}. Specify 'subAsset':'name' to force a choice.";
            }

            // Ambiguous — multiple candidates matched. Make the caller disambiguate.
            var matchingNames = new List<string>();
            foreach (var sub in allSubs)
            {
                if (sub == null || ReferenceEquals(sub, asset)) continue;
                if (TryAssignAndVerify(sp, sub)) matchingNames.Add($"{sub.name}({sub.GetType().Name})");
            }
            sp.objectReferenceValue = null;
            return $"Ambiguous — multiple sub-assets at '{assetPath}' are compatible with '{sp.propertyPath}'. Specify 'subAsset':'name'. Candidates: {string.Join(", ", matchingNames)}.";
        }

        /// <summary>
        /// Assign to the property and verify the assignment stuck. Unity silently
        /// drops object-reference assignments when the target type doesn't match
        /// the serialized field's expected type — reading back tells us whether
        /// Unity accepted it.
        /// </summary>
        static bool TryAssignAndVerify(SerializedProperty sp, UnityEngine.Object candidate)
        {
            sp.objectReferenceValue = candidate;
            return ReferenceEquals(sp.objectReferenceValue, candidate);
        }

        /// <summary>
        /// Resolve a GameObject (or one of its components) and assign to the SerializedProperty.
        /// <paramref name="componentHint"/> overrides auto-resolution by <paramref name="fieldType"/> —
        /// needed when the field type is a base class (Behaviour, Component) and multiple subtypes exist,
        /// or when the field stores a GameObject but the caller wants a specific component reference.
        /// </summary>
        static string ResolveAndAssign(SerializedProperty sp, GameObject go, Type fieldType, Type componentHint = null)
        {
            // Prefer explicit component hint; fall back to the field type.
            Type target = componentHint ?? fieldType;

            // Component/Behaviour field — look up by type.
            if (target != null && typeof(Component).IsAssignableFrom(target))
            {
                var comp = go.GetComponent(target);
                if (comp == null)
                    return $"'{go.name}' does not have a '{target.Name}' component.";

                // Guard: if the user passed a component hint, the resolved component must still fit
                // the actual field type (e.g., field is PlayerController, hint is GameObject → error).
                if (fieldType != null && fieldType != target && !fieldType.IsAssignableFrom(comp.GetType()))
                    return $"Component '{comp.GetType().Name}' is not assignable to field of type '{fieldType.Name}'.";

                sp.objectReferenceValue = comp;
                return null;
            }

            // GameObject / UnityEngine.Object field.
            if (target == null || target == typeof(GameObject) || target == typeof(UnityEngine.Object))
            {
                sp.objectReferenceValue = go;
                return null;
            }

            // Transform / RectTransform field.
            if (target == typeof(Transform) || target == typeof(RectTransform))
            {
                sp.objectReferenceValue = go.transform;
                return null;
            }

            return $"'{go.name}' cannot be assigned to field of type '{target?.Name ?? "unknown"}'.";
        }

        static string SetObjectReferenceFromScene(SerializedProperty sp, string objectPath, Type fieldType, Type componentHint = null)
        {
            var go = FindSceneObject(objectPath, out string findError);
            if (go == null)
                return findError ?? $"Scene object not found at path: {objectPath}";
            return ResolveAndAssign(sp, go, fieldType, componentHint);
        }

        /// <summary>
        /// Determine the C# Type of the field backing a SerializedProperty via reflection.
        /// Walks the property path, unwrapping array/List&lt;T&gt; element types at "Array.data[N]"
        /// segments so array-element paths resolve to their element type (not the array type).
        /// </summary>
        static Type GetFieldType(SerializedProperty sp, Component context)
        {
            if (context == null) return null;

            try
            {
                Type type = context.GetType();
                string[] parts = sp.propertyPath.Split('.');

                for (int i = 0; i < parts.Length; i++)
                {
                    string part = parts[i];

                    if (part == "Array")
                    {
                        // Expect "Array" to be followed by "data[N]"; unwrap to the element type.
                        if (i + 1 < parts.Length && parts[i + 1].StartsWith("data["))
                            i++;
                        if (type != null)
                        {
                            if (type.IsArray)
                                type = type.GetElementType();
                            else if (type.IsGenericType && type.GetGenericTypeDefinition() == typeof(List<>))
                                type = type.GetGenericArguments()[0];
                        }
                        continue;
                    }

                    var field = type?.GetField(part,
                        BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance);
                    if (field == null) return null;
                    type = field.FieldType;
                }

                return type;
            }
            catch
            {
                return null;
            }
        }

        // ── Scene object finder (shared) ──

        /// <summary>
        /// Resolve a scene object by path across all loaded scenes. Returns null on failure;
        /// use the overload with <paramref name="error"/> for diagnostic messages.
        /// </summary>
        public static GameObject FindSceneObject(string path)
        {
            return FindSceneObject(path, out _);
        }

        /// <summary>
        /// Resolve a scene object by path, with diagnostic error reporting.
        /// Accepts:
        ///   "/Root/Child/Grandchild"  — absolute: first segment must be a root-level object.
        ///   "Root/Child"              — same as absolute (first segment is a root name).
        ///   "Grandchild"              — bare name: recursive search across all loaded scenes.
        ///   "Parent/Grandchild"       — bare prefix: recursive search anywhere the chain matches.
        /// On ambiguous matches, returns null with a descriptive <paramref name="error"/>.
        /// Searches every loaded scene (active + additive).
        /// </summary>
        public static GameObject FindSceneObject(string path, out string error)
        {
            error = null;
            if (string.IsNullOrEmpty(path))
            {
                error = "Scene path is empty.";
                return null;
            }

            bool rooted = path.StartsWith("/");
            string stripped = rooted ? path.Substring(1) : path;

            string[] parts = stripped.Split('/');
            if (parts.Length == 0 || string.IsNullOrEmpty(parts[0]))
            {
                error = "Scene path is empty.";
                return null;
            }

            // Gather roots from every loaded scene (supports additive loading).
            var allRoots = new List<GameObject>();
            for (int s = 0; s < SceneManager.sceneCount; s++)
            {
                var scene = SceneManager.GetSceneAt(s);
                if (!scene.IsValid() || !scene.isLoaded) continue;
                allRoots.AddRange(scene.GetRootGameObjects());
            }

            // Pass 1: treat parts[0] as a root name.
            var rootAnchored = new List<GameObject>();
            foreach (var root in allRoots)
            {
                if (root.name != parts[0]) continue;
                var leaf = TraverseFromRoot(root.transform, parts);
                if (leaf != null) rootAnchored.Add(leaf);
            }

            if (rootAnchored.Count == 1) return rootAnchored[0];
            if (rootAnchored.Count > 1)
            {
                error = $"Ambiguous scene path '{(rooted ? "/" : "")}{stripped}' matches {rootAnchored.Count} root-anchored objects: {DescribeMatches(rootAnchored)}. Disambiguate by using a deeper path.";
                return null;
            }

            // Absolute path with no root match — do not fall back to deep search.
            if (rooted)
            {
                error = $"Scene object not found at absolute path: /{stripped}. (Leading '/' requires a root-level object; drop the slash to search all descendants.)";
                return null;
            }

            // Pass 2: recursive descendant search across all scenes.
            var deep = new List<GameObject>();
            foreach (var root in allRoots)
                SearchRecursive(root.transform, parts, deep);

            if (deep.Count == 1) return deep[0];
            if (deep.Count > 1)
            {
                error = $"Ambiguous scene path '{stripped}' matches {deep.Count} objects: {DescribeMatches(deep)}. Qualify with parent segments or use a leading '/' for root-anchored lookup.";
                return null;
            }

            error = $"Scene object not found at path: {path}.";
            return null;
        }

        static GameObject TraverseFromRoot(Transform anchor, string[] parts)
        {
            // parts[0] has already matched anchor.name; walk remaining segments.
            Transform cur = anchor;
            for (int i = 1; i < parts.Length; i++)
            {
                Transform child = cur.Find(parts[i]);
                if (child == null) return null;
                cur = child;
            }
            return cur.gameObject;
        }

        static void SearchRecursive(Transform t, string[] parts, List<GameObject> matches)
        {
            if (t.name == parts[0])
            {
                var leaf = TraverseFromRoot(t, parts);
                if (leaf != null) matches.Add(leaf);
            }
            for (int i = 0; i < t.childCount; i++)
                SearchRecursive(t.GetChild(i), parts, matches);
        }

        static string DescribeMatches(List<GameObject> matches)
        {
            const int MaxShown = 5;
            int shown = Math.Min(matches.Count, MaxShown);
            var paths = new string[shown];
            for (int i = 0; i < shown; i++) paths[i] = GetScenePath(matches[i]);
            string joined = string.Join(", ", paths);
            if (matches.Count > MaxShown) joined += $", +{matches.Count - MaxShown} more";
            return joined;
        }

        /// <summary>Return the full hierarchy path of a scene GameObject (leading '/').</summary>
        public static string GetScenePath(GameObject go)
        {
            if (go == null) return null;
            string p = go.name;
            var parent = go.transform.parent;
            while (parent != null)
            {
                p = parent.name + "/" + p;
                parent = parent.parent;
            }
            return "/" + p;
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
