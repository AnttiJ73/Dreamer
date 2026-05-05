using System;
using System.Collections.Generic;
using System.IO;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace Dreamer.AgentBridge
{
    public static class SceneOps
    {
        // Canonical key is parentPath; `parent` is an alias because agents reach for it naturally
        // and silent-ignore previously placed the GO at scene root with no error.
        static string ResolveParentPath(Dictionary<string, object> args)
        {
            string canonical = SimpleJson.GetString(args, "parentPath");
            if (!string.IsNullOrEmpty(canonical)) return canonical;
            string alias = SimpleJson.GetString(args, "parent");
            if (!string.IsNullOrEmpty(alias))
            {
                DreamerLog.Warn($"'parent' is accepted as an alias — use 'parentPath' in future calls. Resolved to: '{alias}'");
                return alias;
            }
            return null;
        }

        /// <summary>Create a new empty GameObject in the active scene. Args: { name, parentPath?, scene? }</summary>
        public static CommandResult CreateGameObject(Dictionary<string, object> args)
        {
            string name = SimpleJson.GetString(args, "name", "GameObject");
            string parentPath = ResolveParentPath(args);

            var go = new GameObject(name);
            Undo.RegisterCreatedObjectUndo(go, $"Create {name}");

            if (!string.IsNullOrEmpty(parentPath))
            {
                var parent = PropertyOps.FindSceneObject(parentPath, out string parentError);
                if (parent == null)
                {
                    UnityEngine.Object.DestroyImmediate(go);
                    return CommandResult.Fail(parentError ?? $"Parent not found at path: {parentPath}");
                }
                go.transform.SetParent(parent.transform, false);
            }

            var json = SimpleJson.Object()
                .Put("name", go.name)
                .Put("instanceId", go.GetInstanceID())
                .Put("path", GetGameObjectPath(go))
                .Put("created", true)
                .ToString();

            return CommandResult.Ok(json);
        }

        /// <summary>Rename a GameObject in scene or prefab. Scene: { sceneObjectPath, newName }. Prefab: { assetPath, childPath?, newName }.</summary>
        public static CommandResult RenameGameObject(Dictionary<string, object> args)
        {
            string newName = SimpleJson.GetString(args, "newName");
            if (string.IsNullOrEmpty(newName))
                return CommandResult.Fail("'newName' is required.");

            string sceneObjectPath = SimpleJson.GetString(args, "sceneObjectPath");
            if (!string.IsNullOrEmpty(sceneObjectPath))
            {
                var go = PropertyOps.FindSceneObject(sceneObjectPath, out string findError);
                if (go == null)
                    return CommandResult.Fail(findError ?? $"Scene object not found: {sceneObjectPath}");

                string oldName = go.name;
                Undo.RecordObject(go, $"Rename {oldName} to {newName}");
                go.name = newName;
                EditorUtility.SetDirty(go);

                return CommandResult.Ok(SimpleJson.Object()
                    .Put("renamed", true).Put("oldName", oldName).Put("newName", newName)
                    .Put("path", GetGameObjectPath(go)).ToString());
            }

            string assetPath = AssetOps.ResolveAssetPath(args);
            if (assetPath == null)
                return CommandResult.Fail("Provide 'sceneObjectPath' or 'assetPath'.");

            string childPath = SimpleJson.GetString(args, "childPath");

            if (!assetPath.EndsWith(".prefab", StringComparison.OrdinalIgnoreCase))
            {
                string error = AssetDatabase.RenameAsset(assetPath, newName);
                if (!string.IsNullOrEmpty(error))
                    return CommandResult.Fail($"Failed to rename asset: {error}");
                return CommandResult.Ok(SimpleJson.Object()
                    .Put("renamed", true).Put("assetPath", assetPath).Put("newName", newName).ToString());
            }

            if (string.IsNullOrEmpty(childPath))
            {
                string error = AssetDatabase.RenameAsset(assetPath, newName);
                if (!string.IsNullOrEmpty(error))
                    return CommandResult.Fail($"Failed to rename prefab: {error}");
                return CommandResult.Ok(SimpleJson.Object()
                    .Put("renamed", true).Put("assetPath", assetPath).Put("newName", newName).ToString());
            }

            var prefabRoot = PrefabUtility.LoadPrefabContents(assetPath);
            if (prefabRoot == null)
                return CommandResult.Fail($"Failed to load prefab: {assetPath}");

            try
            {
                Transform child = prefabRoot.transform.Find(childPath);
                if (child == null)
                {
                    PrefabOps.SafeUnloadPrefabContents(prefabRoot);
                    return CommandResult.Fail($"Child '{childPath}' not found in prefab.");
                }

                string oldName = child.gameObject.name;
                child.gameObject.name = newName;
                PrefabUtility.SaveAsPrefabAsset(prefabRoot, assetPath);

                return CommandResult.Ok(SimpleJson.Object()
                    .Put("renamed", true).Put("oldName", oldName).Put("newName", newName)
                    .Put("assetPath", assetPath).Put("childPath", childPath).ToString());
            }
            finally
            {
                PrefabOps.SafeUnloadPrefabContents(prefabRoot);
            }
        }

        /// <summary>Duplicate a GameObject in scene or within a prefab. Scene: { sceneObjectPath, newName? }. Prefab child: { assetPath, childPath, newName? }. Asset: { assetPath, newName? } duplicates the file.</summary>
        public static CommandResult DuplicateGameObject(Dictionary<string, object> args)
        {
            string newName = SimpleJson.GetString(args, "newName");

            string sceneObjectPath = SimpleJson.GetString(args, "sceneObjectPath");
            if (!string.IsNullOrEmpty(sceneObjectPath))
            {
                var go = PropertyOps.FindSceneObject(sceneObjectPath, out string findError);
                if (go == null)
                    return CommandResult.Fail(findError ?? $"Scene object not found: {sceneObjectPath}");

                var clone = UnityEngine.Object.Instantiate(go, go.transform.parent);
                clone.name = !string.IsNullOrEmpty(newName) ? newName : go.name + " (Copy)";
                Undo.RegisterCreatedObjectUndo(clone, $"Duplicate {go.name}");

                return CommandResult.Ok(SimpleJson.Object()
                    .Put("duplicated", true)
                    .Put("name", clone.name)
                    .Put("instanceId", clone.GetInstanceID())
                    .Put("path", GetGameObjectPath(clone))
                    .ToString());
            }

            string assetPath = AssetOps.ResolveAssetPath(args);
            if (assetPath == null)
                return CommandResult.Fail("Provide 'sceneObjectPath' or 'assetPath'.");

            string childPath = SimpleJson.GetString(args, "childPath");

            if (!string.IsNullOrEmpty(childPath))
            {
                if (!assetPath.EndsWith(".prefab", StringComparison.OrdinalIgnoreCase))
                    return CommandResult.Fail($"Asset is not a prefab: {assetPath}");

                var prefabRoot = PrefabUtility.LoadPrefabContents(assetPath);
                if (prefabRoot == null)
                    return CommandResult.Fail($"Failed to load prefab: {assetPath}");

                try
                {
                    Transform child = prefabRoot.transform.Find(childPath);
                    if (child == null)
                    {
                        PrefabOps.SafeUnloadPrefabContents(prefabRoot);
                        return CommandResult.Fail($"Child '{childPath}' not found in prefab.");
                    }

                    var clone = UnityEngine.Object.Instantiate(child.gameObject, child.parent);
                    clone.name = !string.IsNullOrEmpty(newName) ? newName : child.gameObject.name + " (Copy)";
                    PrefabUtility.SaveAsPrefabAsset(prefabRoot, assetPath);

                    return CommandResult.Ok(SimpleJson.Object()
                        .Put("duplicated", true)
                        .Put("name", clone.name)
                        .Put("assetPath", assetPath)
                        .ToString());
                }
                finally
                {
                    PrefabOps.SafeUnloadPrefabContents(prefabRoot);
                }
            }

            string dir = System.IO.Path.GetDirectoryName(assetPath).Replace('\\', '/');
            string ext = System.IO.Path.GetExtension(assetPath);
            string baseName = System.IO.Path.GetFileNameWithoutExtension(assetPath);
            string copyName = !string.IsNullOrEmpty(newName) ? newName : baseName + "_Copy";
            string copyPath = $"{dir}/{copyName}{ext}";

            if (!AssetDatabase.CopyAsset(assetPath, copyPath))
                return CommandResult.Fail($"Failed to duplicate asset to: {copyPath}");

            string guid = AssetDatabase.AssetPathToGUID(copyPath);
            return CommandResult.Ok(SimpleJson.Object()
                .Put("duplicated", true)
                .Put("sourcePath", assetPath)
                .Put("newPath", copyPath)
                .Put("guid", guid)
                .ToString());
        }

        /// <summary>Reparent a GameObject. Scene: { sceneObjectPath, newParentPath?, keepWorldSpace?, siblingIndex? }. Prefab: { assetPath, childPath, newParentPath?, keepWorldSpace?, siblingIndex? } — paths relative to prefab root, empty newParentPath → root.</summary>
        public static CommandResult ReparentGameObject(Dictionary<string, object> args)
        {
            string sceneObjectPath = SimpleJson.GetString(args, "sceneObjectPath");
            if (!string.IsNullOrEmpty(sceneObjectPath))
                return ReparentInScene(sceneObjectPath, args);

            string assetPath = AssetOps.ResolveAssetPath(args);
            if (!string.IsNullOrEmpty(assetPath))
                return ReparentInPrefab(assetPath, args);

            return CommandResult.Fail("Provide 'sceneObjectPath' (scene mode) or 'assetPath' + 'childPath' (prefab mode).");
        }

        static CommandResult ReparentInScene(string sceneObjectPath, Dictionary<string, object> args)
        {
            var go = PropertyOps.FindSceneObject(sceneObjectPath, out string findError);
            if (go == null)
                return CommandResult.Fail(findError ?? $"Scene object not found at path: {sceneObjectPath}");

            // Empty/null newParentPath → scene root.
            string newParentPath = SimpleJson.GetString(args, "newParentPath");
            Transform newParent = null;
            if (!string.IsNullOrEmpty(newParentPath))
            {
                var parentGo = PropertyOps.FindSceneObject(newParentPath, out string parentError);
                if (parentGo == null)
                    return CommandResult.Fail(parentError ?? $"New parent not found at path: {newParentPath}");
                newParent = parentGo.transform;

                if (parentGo == go)
                    return CommandResult.Fail("Cannot reparent a GameObject under itself.");
                for (var t = newParent; t != null; t = t.parent)
                {
                    if (t == go.transform)
                        return CommandResult.Fail($"Cannot reparent '{go.name}' under its own descendant '{parentGo.name}'.");
                }
            }

            bool keepWorldSpace = SimpleJson.GetBool(args, "keepWorldSpace", false);
            string oldParentPath = go.transform.parent != null ? GetGameObjectPath(go.transform.parent.gameObject) : null;

            Undo.SetTransformParent(go.transform, newParent, $"Reparent {go.name}");
            // SetTransformParent doesn't expose worldPositionStays in all Unity versions;
            // SetParent right after enforces the user's choice.
            go.transform.SetParent(newParent, keepWorldSpace);

            ApplySiblingIndex(go.transform, newParent, args);
            EditorUtility.SetDirty(go);

            return CommandResult.Ok(SimpleJson.Object()
                .Put("reparented", true)
                .Put("mode", "scene")
                .Put("name", go.name)
                .Put("oldParentPath", oldParentPath)
                .Put("newParentPath", newParent != null ? GetGameObjectPath(newParent.gameObject) : null)
                .Put("keepWorldSpace", keepWorldSpace)
                .Put("path", GetGameObjectPath(go))
                .ToString());
        }

        static CommandResult ReparentInPrefab(string assetPath, Dictionary<string, object> args)
        {
            if (!assetPath.EndsWith(".prefab", StringComparison.OrdinalIgnoreCase))
                return CommandResult.Fail($"Asset is not a prefab: {assetPath}");

            string childPath = SimpleJson.GetString(args, "childPath");
            if (string.IsNullOrEmpty(childPath))
                return CommandResult.Fail("'childPath' is required for prefab reparent (the path of the GameObject to move, relative to the prefab root).");

            string newParentPath = SimpleJson.GetString(args, "newParentPath");
            bool keepWorldSpace = SimpleJson.GetBool(args, "keepWorldSpace", false);

            var prefabRoot = PrefabUtility.LoadPrefabContents(assetPath);
            if (prefabRoot == null)
                return CommandResult.Fail($"Failed to load prefab contents: {assetPath}");

            try
            {
                Transform target = prefabRoot.transform.Find(childPath);
                if (target == null)
                    return CommandResult.Fail($"Child '{childPath}' not found in prefab '{assetPath}'.");

                Transform newParent;
                if (string.IsNullOrEmpty(newParentPath))
                {
                    newParent = prefabRoot.transform;
                }
                else
                {
                    Transform candidate = prefabRoot.transform.Find(newParentPath);
                    if (candidate == null)
                        return CommandResult.Fail($"New parent '{newParentPath}' not found in prefab '{assetPath}'.");
                    newParent = candidate;
                }

                if (newParent == target)
                    return CommandResult.Fail("Cannot reparent a GameObject under itself.");
                for (var t = newParent; t != null; t = t.parent)
                {
                    if (t == target)
                        return CommandResult.Fail($"Cannot reparent '{target.name}' under its own descendant '{newParent.name}'.");
                }

                string oldParentRel = GetPrefabRelativePath(target.parent, prefabRoot.transform);
                target.SetParent(newParent, keepWorldSpace);
                ApplySiblingIndex(target, newParent, args);

                PrefabUtility.SaveAsPrefabAsset(prefabRoot, assetPath);

                return CommandResult.Ok(SimpleJson.Object()
                    .Put("reparented", true)
                    .Put("mode", "prefab")
                    .Put("assetPath", assetPath)
                    .Put("childPath", GetPrefabRelativePath(target, prefabRoot.transform))
                    .Put("oldParentPath", oldParentRel)
                    .Put("newParentPath", string.IsNullOrEmpty(newParentPath) ? "" : newParentPath)
                    .Put("keepWorldSpace", keepWorldSpace)
                    .ToString());
            }
            finally
            {
                PrefabOps.SafeUnloadPrefabContents(prefabRoot);
            }
        }

        static void ApplySiblingIndex(Transform target, Transform newParent, Dictionary<string, object> args)
        {
            if (!args.TryGetValue("siblingIndex", out object siRaw)) return;
            int idx;
            try { idx = Convert.ToInt32(siRaw); }
            catch { idx = -1; }
            if (idx < 0) return;
            int max = newParent != null ? newParent.childCount - 1 : 0;
            target.SetSiblingIndex(Mathf.Clamp(idx, 0, max));
        }

        /// <summary>Path of t relative to root, or "" if t == root.</summary>
        static string GetPrefabRelativePath(Transform t, Transform root)
        {
            if (t == null || t == root) return "";
            var stack = new System.Collections.Generic.List<string>();
            for (var cur = t; cur != null && cur != root; cur = cur.parent)
                stack.Add(cur.name);
            stack.Reverse();
            return string.Join("/", stack);
        }

        /// <summary>Delete a GameObject from scene or prefab. Children destroyed with parent. Scene: { sceneObjectPath }. Prefab: { assetPath, childPath }.</summary>
        public static CommandResult DeleteGameObject(Dictionary<string, object> args)
        {
            string sceneObjectPath = SimpleJson.GetString(args, "sceneObjectPath");
            if (!string.IsNullOrEmpty(sceneObjectPath))
            {
                var go = PropertyOps.FindSceneObject(sceneObjectPath, out string findError);
                if (go == null)
                    return CommandResult.Fail(findError ?? $"Scene object not found at path: {sceneObjectPath}");

                string name = go.name;
                int childCount = go.transform.childCount;

                Undo.DestroyObjectImmediate(go);

                var json = SimpleJson.Object()
                    .Put("deleted", true)
                    .Put("name", name)
                    .Put("sceneObjectPath", sceneObjectPath)
                    .Put("childrenAlsoDeleted", childCount)
                    .ToString();
                return CommandResult.Ok(json);
            }

            string assetPath = AssetOps.ResolveAssetPath(args);
            if (assetPath == null)
                return CommandResult.Fail("Target not found. Provide 'sceneObjectPath' or 'assetPath'+'childPath'.");

            string childPath = SimpleJson.GetString(args, "childPath");
            if (string.IsNullOrEmpty(childPath))
                return CommandResult.Fail("'childPath' is required when deleting from a prefab (cannot delete prefab root).");

            if (!assetPath.EndsWith(".prefab", StringComparison.OrdinalIgnoreCase))
                return CommandResult.Fail($"Asset is not a prefab: {assetPath}");

            var prefabRoot = PrefabUtility.LoadPrefabContents(assetPath);
            if (prefabRoot == null)
                return CommandResult.Fail($"Failed to load prefab: {assetPath}");

            try
            {
                Transform child = prefabRoot.transform.Find(childPath);
                if (child == null)
                {
                    PrefabOps.SafeUnloadPrefabContents(prefabRoot);
                    return CommandResult.Fail($"Child '{childPath}' not found in prefab '{assetPath}'.");
                }

                string childName = child.gameObject.name;
                int childChildren = child.childCount;

                UnityEngine.Object.DestroyImmediate(child.gameObject);
                PrefabUtility.SaveAsPrefabAsset(prefabRoot, assetPath);

                var json = SimpleJson.Object()
                    .Put("deleted", true)
                    .Put("name", childName)
                    .Put("assetPath", assetPath)
                    .Put("childPath", childPath)
                    .Put("childrenAlsoDeleted", childChildren)
                    .ToString();
                return CommandResult.Ok(json);
            }
            finally
            {
                PrefabOps.SafeUnloadPrefabContents(prefabRoot);
            }
        }

        /// <summary>Set GameObject.layer (the anchor field set-property can't reach). Scene: { sceneObjectPath, layer, recursive? }. Prefab: { assetPath, childPath?, layer, recursive? }. layer = name (string) or index (0–31).</summary>
        public static CommandResult SetLayer(Dictionary<string, object> args)
        {
            object layerArg = SimpleJson.GetValue(args, "layer");
            if (layerArg == null)
                return CommandResult.Fail("'layer' is required (layer name or numeric index 0–31).");

            int layerIndex;
            string layerName;
            var resolveErr = ResolveLayer(layerArg, out layerIndex, out layerName);
            if (resolveErr != null) return CommandResult.Fail(resolveErr);

            bool recursive = SimpleJson.GetBool(args, "recursive", false);

            string sceneObjectPath = SimpleJson.GetString(args, "sceneObjectPath");
            if (!string.IsNullOrEmpty(sceneObjectPath))
            {
                var go = PropertyOps.FindSceneObject(sceneObjectPath, out string findError);
                if (go == null)
                    return CommandResult.Fail(findError ?? $"Scene object not found: {sceneObjectPath}");

                int prevLayer = go.layer;
                int applied = ApplyLayer(go, layerIndex, recursive, "Set Layer");

                return CommandResult.Ok(SimpleJson.Object()
                    .Put("set", true)
                    .Put("layerIndex", layerIndex)
                    .Put("layerName", layerName)
                    .Put("previousLayerIndex", prevLayer)
                    .Put("previousLayerName", LayerMask.LayerToName(prevLayer))
                    .Put("path", GetGameObjectPath(go))
                    .Put("appliedToCount", applied)
                    .ToString());
            }

            string assetPath = AssetOps.ResolveAssetPath(args);
            if (assetPath == null)
                return CommandResult.Fail("Provide 'sceneObjectPath' (scene mode) or 'assetPath'/'guid' (prefab mode).");

            if (!assetPath.EndsWith(".prefab", StringComparison.OrdinalIgnoreCase))
                return CommandResult.Fail($"Asset is not a prefab: {assetPath}. set-layer targets GameObjects only.");

            string childPath = SimpleJson.GetString(args, "childPath");

            var prefabRoot = PrefabUtility.LoadPrefabContents(assetPath);
            if (prefabRoot == null)
                return CommandResult.Fail($"Failed to load prefab: {assetPath}");

            try
            {
                GameObject target;
                if (string.IsNullOrEmpty(childPath))
                {
                    target = prefabRoot;
                }
                else
                {
                    Transform child = prefabRoot.transform.Find(childPath);
                    if (child == null)
                        return CommandResult.Fail($"Child '{childPath}' not found in prefab '{assetPath}'.");
                    target = child.gameObject;
                }

                int prevLayer = target.layer;
                int applied = ApplyLayer(target, layerIndex, recursive, null); // Undo not applicable inside isolated prefab scene
                PrefabUtility.SaveAsPrefabAsset(prefabRoot, assetPath);

                return CommandResult.Ok(SimpleJson.Object()
                    .Put("set", true)
                    .Put("layerIndex", layerIndex)
                    .Put("layerName", layerName)
                    .Put("previousLayerIndex", prevLayer)
                    .Put("previousLayerName", LayerMask.LayerToName(prevLayer))
                    .Put("assetPath", assetPath)
                    .Put("childPath", childPath ?? "")
                    .Put("appliedToCount", applied)
                    .ToString());
            }
            finally
            {
                PrefabOps.SafeUnloadPrefabContents(prefabRoot);
            }
        }

        static string ResolveLayer(object layerArg, out int layerIndex, out string layerName)
        {
            layerIndex = -1;
            layerName = null;

            if (layerArg is int i) { layerIndex = i; }
            else if (layerArg is long l) { layerIndex = (int)l; }
            else if (layerArg is double d) { layerIndex = (int)d; }
            else if (layerArg is string s)
            {
                if (int.TryParse(s, out int parsed)) layerIndex = parsed;
                else
                {
                    int byName = LayerMask.NameToLayer(s);
                    if (byName < 0)
                    {
                        var named = new List<string>();
                        for (int n = 0; n < 32; n++)
                        {
                            string nm = LayerMask.LayerToName(n);
                            if (!string.IsNullOrEmpty(nm)) named.Add($"{n}:{nm}");
                        }
                        return $"Layer name '{s}' is not defined. Available: {string.Join(", ", named)}. " +
                            $"Add it first with `./bin/dreamer set-layer-name --index N --name {s} --wait`.";
                    }
                    layerIndex = byName;
                }
            }
            else
            {
                return $"'layer' must be a string (name) or number (index). Got: {layerArg.GetType().Name}";
            }

            if (layerIndex < 0 || layerIndex > 31)
                return $"Layer index {layerIndex} out of range. Unity layers are 0–31 (32-bit mask).";

            layerName = LayerMask.LayerToName(layerIndex);
            return null;
        }

        static int ApplyLayer(GameObject go, int layerIndex, bool recursive, string undoLabel)
        {
            int count = 0;
            if (recursive)
            {
                foreach (var t in go.GetComponentsInChildren<Transform>(true))
                {
                    if (undoLabel != null) Undo.RecordObject(t.gameObject, undoLabel);
                    t.gameObject.layer = layerIndex;
                    EditorUtility.SetDirty(t.gameObject);
                    count++;
                }
            }
            else
            {
                if (undoLabel != null) Undo.RecordObject(go, undoLabel);
                go.layer = layerIndex;
                EditorUtility.SetDirty(go);
                count = 1;
            }
            return count;
        }

        /// <summary>Inspect scene hierarchy or a prefab's hierarchy. Args: { scene? } or { assetPath?/guid? }</summary>
        public static CommandResult InspectHierarchy(Dictionary<string, object> args)
        {
            var opts = new InspectionOptions
            {
                Depth = SimpleJson.GetInt(args, "depth", -1),
                IncludeTransforms = SimpleJson.GetBool(args, "includeTransforms", false),
                IncludeFields = SimpleJson.GetBool(args, "includeFields", false),
            };

            string assetPath = SimpleJson.GetString(args, "assetPath");
            if (string.IsNullOrEmpty(assetPath))
            {
                string guid = SimpleJson.GetString(args, "guid");
                if (!string.IsNullOrEmpty(guid))
                    assetPath = AssetDatabase.GUIDToAssetPath(guid);
            }
            if (!string.IsNullOrEmpty(assetPath))
            {
                if (!assetPath.EndsWith(".prefab", System.StringComparison.OrdinalIgnoreCase))
                    return CommandResult.Fail($"--asset for inspect-hierarchy must be a .prefab. Got: {assetPath}");
                var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(assetPath);
                if (prefab == null)
                    return CommandResult.Fail($"Prefab not found at: {assetPath}");
                string nodeJson = Inspection.BuildGameObjectInfo(prefab, opts);
                var json = SimpleJson.Object()
                    .Put("assetPath", assetPath)
                    .Put("guid", AssetDatabase.AssetPathToGUID(assetPath))
                    .Put("source", "prefab")
                    .PutRaw("root", nodeJson)
                    .ToString();
                return CommandResult.Ok(json);
            }

            string sceneName = SimpleJson.GetString(args, "scene");

            Scene scene;
            if (!string.IsNullOrEmpty(sceneName))
            {
                scene = SceneManager.GetSceneByName(sceneName);
                if (!scene.IsValid() || !scene.isLoaded)
                {
                    scene = SceneManager.GetSceneByPath(sceneName);
                    if (!scene.IsValid() || !scene.isLoaded)
                        return CommandResult.Fail($"Scene not found or not loaded: {sceneName}");
                }
            }
            else
            {
                scene = SceneManager.GetActiveScene();
            }

            var rootObjects = scene.GetRootGameObjects();
            var rootArr = SimpleJson.Array();

            foreach (var root in rootObjects)
            {
                rootArr.AddRaw(Inspection.BuildGameObjectInfo(root, opts));
            }

            var sceneJson = SimpleJson.Object()
                .Put("scene", scene.name)
                .Put("scenePath", scene.path)
                .Put("source", "scene")
                .Put("rootObjectCount", rootObjects.Length)
                .PutRaw("rootObjects", rootArr.ToString())
                .ToString();

            return CommandResult.Ok(sceneJson);
        }

        /// <summary>Instantiate a prefab into the active scene. Args: { assetPath?, guid?, name?, parentPath?, position?, rotation? }</summary>
        public static CommandResult InstantiatePrefab(Dictionary<string, object> args)
        {
            string assetPath = AssetOps.ResolveAssetPath(args);
            if (assetPath == null)
                return CommandResult.Fail("Prefab not found. Provide 'assetPath' or 'guid'.");

            var prefab = AssetDatabase.LoadMainAssetAtPath(assetPath) as GameObject;
            if (prefab == null)
                return CommandResult.Fail($"Asset at '{assetPath}' is not a GameObject/Prefab.");

            var instance = PrefabUtility.InstantiatePrefab(prefab) as GameObject;
            if (instance == null)
                return CommandResult.Fail($"Failed to instantiate prefab: {assetPath}");

            Undo.RegisterCreatedObjectUndo(instance, $"Instantiate {prefab.name}");

            string nameOverride = SimpleJson.GetString(args, "name");
            if (!string.IsNullOrEmpty(nameOverride))
                instance.name = nameOverride;

            string parentPath = ResolveParentPath(args);
            if (!string.IsNullOrEmpty(parentPath))
            {
                var parent = PropertyOps.FindSceneObject(parentPath, out string parentError);
                if (parent != null)
                    instance.transform.SetParent(parent.transform, false);
                else
                    DreamerLog.Warn($"Parent not found: {parentPath} ({parentError}), placing at root.");
            }

            if (args.TryGetValue("position", out object posObj) && posObj is Dictionary<string, object> posDict)
            {
                instance.transform.position = new Vector3(
                    GetFloat(posDict, "x"), GetFloat(posDict, "y"), GetFloat(posDict, "z"));
            }

            if (args.TryGetValue("rotation", out object rotObj) && rotObj is Dictionary<string, object> rotDict)
            {
                instance.transform.eulerAngles = new Vector3(
                    GetFloat(rotDict, "x"), GetFloat(rotDict, "y"), GetFloat(rotDict, "z"));
            }

            var json = SimpleJson.Object()
                .Put("name", instance.name)
                .Put("instanceId", instance.GetInstanceID())
                .Put("path", GetGameObjectPath(instance))
                .Put("prefabPath", assetPath)
                .Put("prefabGuid", AssetDatabase.AssetPathToGUID(assetPath))
                .Put("instantiated", true)
                .ToString();

            return CommandResult.Ok(json);
        }

        /// <summary>Create a new scene. Args: { name, path?, setActive? }</summary>
        public static CommandResult CreateScene(Dictionary<string, object> args)
        {
            string name = SimpleJson.GetString(args, "name");
            if (string.IsNullOrEmpty(name))
                return CommandResult.Fail("'name' is required.");

            string folder = SimpleJson.GetString(args, "path", "Assets/Scenes");
            bool setActive = SimpleJson.GetBool(args, "setActive", true);

            string fullDir = Path.GetFullPath(folder);
            if (!Directory.Exists(fullDir))
            {
                Directory.CreateDirectory(fullDir);
                AssetDatabase.Refresh();
            }

            string scenePath = $"{folder}/{name}.unity";

            var mode = setActive ? NewSceneMode.Single : NewSceneMode.Additive;
            var scene = EditorSceneManager.NewScene(NewSceneSetup.DefaultGameObjects, mode);

            bool saved = EditorSceneManager.SaveScene(scene, scenePath);
            if (!saved)
                return CommandResult.Fail($"Failed to save scene at: {scenePath}");

            if (setActive)
                SceneManager.SetActiveScene(scene);

            var json = SimpleJson.Object()
                .Put("name", scene.name)
                .Put("path", scenePath)
                .Put("created", true)
                .ToString();

            return CommandResult.Ok(json);
        }

        /// <summary>Open an existing scene. Args: { path, mode?: "single"|"additive" }</summary>
        public static CommandResult OpenScene(Dictionary<string, object> args)
        {
            string scenePath = SimpleJson.GetString(args, "path");
            if (string.IsNullOrEmpty(scenePath))
                return CommandResult.Fail("'path' is required.");

            if (!File.Exists(Path.GetFullPath(scenePath)))
                return CommandResult.Fail($"Scene file not found: {scenePath}");

            string modeStr = SimpleJson.GetString(args, "mode", "single");
            OpenSceneMode mode = modeStr.Equals("additive", StringComparison.OrdinalIgnoreCase)
                ? OpenSceneMode.Additive
                : OpenSceneMode.Single;

            var scene = EditorSceneManager.OpenScene(scenePath, mode);
            if (!scene.IsValid())
                return CommandResult.Fail($"Failed to open scene: {scenePath}");

            var json = SimpleJson.Object()
                .Put("name", scene.name)
                .Put("path", scene.path)
                .Put("opened", true)
                .ToString();

            return CommandResult.Ok(json);
        }

        /// <summary>Save the current scene or a specific scene. Args: { path? }</summary>
        public static CommandResult SaveScene(Dictionary<string, object> args)
        {
            string scenePath = SimpleJson.GetString(args, "path");

            if (!string.IsNullOrEmpty(scenePath))
            {
                var scene = SceneManager.GetSceneByPath(scenePath);
                if (!scene.IsValid() || !scene.isLoaded)
                    return CommandResult.Fail($"Scene not found or not loaded: {scenePath}");

                bool saved = EditorSceneManager.SaveScene(scene);
                if (!saved)
                    return CommandResult.Fail($"Failed to save scene: {scenePath}");

                var json = SimpleJson.Object()
                    .Put("name", scene.name)
                    .Put("path", scene.path)
                    .Put("saved", true)
                    .ToString();

                return CommandResult.Ok(json);
            }
            else
            {
                bool saved = EditorSceneManager.SaveOpenScenes();
                if (!saved)
                    return CommandResult.Fail("Failed to save open scenes.");

                var activeScene = SceneManager.GetActiveScene();
                var json = SimpleJson.Object()
                    .Put("name", activeScene.name)
                    .Put("path", activeScene.path)
                    .Put("saved", true)
                    .ToString();

                return CommandResult.Ok(json);
            }
        }

        /// <summary>Create a hierarchy with components. Scene: { name, components?, children? }. Prefab: same + { savePath } — builds, saves as prefab, destroys temp.</summary>
        public static CommandResult CreateHierarchy(Dictionary<string, object> args)
        {
            string name = SimpleJson.GetString(args, "name", "GameObject");
            string savePath = SimpleJson.GetString(args, "savePath");
            string parentPath = ResolveParentPath(args);

            Transform parent = null;
            if (!string.IsNullOrEmpty(parentPath))
            {
                var parentGo = PropertyOps.FindSceneObject(parentPath, out string parentError);
                if (parentGo == null)
                    return CommandResult.Fail(parentError ?? $"Parent not found at path: {parentPath}");
                parent = parentGo.transform;
            }

            var warnings = new List<string>();
            var go = CreateNode(args, parent, warnings);
            if (go == null)
                return CommandResult.Fail("Failed to create root GameObject.");

            if (!string.IsNullOrEmpty(savePath))
            {
                string fullDir = System.IO.Path.GetFullPath(savePath);
                if (!System.IO.Directory.Exists(fullDir))
                {
                    System.IO.Directory.CreateDirectory(fullDir);
                    AssetDatabase.Refresh();
                }

                string assetPath = $"{savePath}/{name}.prefab";
                if (System.IO.File.Exists(System.IO.Path.GetFullPath(assetPath)))
                {
                    UnityEngine.Object.DestroyImmediate(go);
                    return CommandResult.Fail($"Prefab already exists at: {assetPath}");
                }

                var prefab = PrefabUtility.SaveAsPrefabAsset(go, assetPath, out bool success);
                UnityEngine.Object.DestroyImmediate(go);

                if (!success || prefab == null)
                    return CommandResult.Fail($"Failed to save prefab at: {assetPath}");

                string guid = AssetDatabase.AssetPathToGUID(assetPath);
                var prefabJson = SimpleJson.Object()
                    .Put("name", name)
                    .Put("path", assetPath)
                    .Put("guid", guid)
                    .Put("created", true)
                    .Put("isPrefab", true)
                    .PutRaw("warnings", SerializeWarnings(warnings))
                    .ToString();
                return CommandResult.Ok(prefabJson);
            }

            Undo.RegisterCreatedObjectUndo(go, $"Create hierarchy {name}");

            // Splice warnings into the result via string substitution — re-parsing
            // is overkill, and the happy-path output stays identical when none.
            string resultJson = BuildHierarchyResult(go);
            if (warnings.Count > 0)
            {
                int lastBrace = resultJson.LastIndexOf('}');
                if (lastBrace > 0)
                {
                    resultJson = resultJson.Substring(0, lastBrace)
                        + ",\"warnings\":" + SerializeWarnings(warnings)
                        + "}";
                }
            }
            return CommandResult.Ok(resultJson);
        }

        static string SerializeWarnings(List<string> warnings)
        {
            var arr = SimpleJson.Array();
            foreach (var w in warnings) arr.Add(w);
            return arr.ToString();
        }

        // Component failures land in `warnings` rather than being silently dropped — the old
        // behavior let one unresolved type mask the gap, especially bad during compile errors.
        static GameObject CreateNode(Dictionary<string, object> nodeArgs, Transform parent, List<string> warnings)
        {
            string name = SimpleJson.GetString(nodeArgs, "name", "GameObject");
            var go = new GameObject(name);
            string pathHint = parent == null ? "/" + name : parent.name + "/" + name;

            if (parent != null)
                go.transform.SetParent(parent, false);

            if (nodeArgs.TryGetValue("components", out object compsObj) && compsObj is List<object> compList)
            {
                foreach (var compEntry in compList)
                {
                    string typeName = compEntry as string;
                    if (string.IsNullOrEmpty(typeName))
                    {
                        warnings.Add($"[{pathHint}] Component entry missing/empty type name — skipped.");
                        continue;
                    }

                    Type compType = ComponentOps.ResolveType(typeName);
                    if (compType == null)
                    {
                        warnings.Add($"[{pathHint}] Component '{typeName}' NOT ADDED — type not found. Check compile status (`./bin/dreamer compile-status`); a compile error can hide user types.");
                        continue;
                    }
                    if (!typeof(Component).IsAssignableFrom(compType))
                    {
                        warnings.Add($"[{pathHint}] Component '{typeName}' NOT ADDED — '{compType.FullName}' is not a Component.");
                        continue;
                    }

                    if (compType == typeof(Transform) || compType == typeof(RectTransform)) continue;

                    if (go.GetComponent(compType) != null)
                    {
                        warnings.Add($"[{pathHint}] Component '{typeName}' already present — skipped duplicate.");
                        continue;
                    }

                    go.AddComponent(compType);
                }
            }

            if (nodeArgs.TryGetValue("children", out object childrenObj) && childrenObj is List<object> childList)
            {
                foreach (var childEntry in childList)
                {
                    if (childEntry is Dictionary<string, object> childArgs)
                        CreateNode(childArgs, go.transform, warnings);
                }
            }

            return go;
        }

        static string BuildHierarchyResult(GameObject go)
        {
            var obj = SimpleJson.Object()
                .Put("name", go.name)
                .Put("instanceId", go.GetInstanceID())
                .Put("path", GetGameObjectPath(go))
                .Put("created", true);

            var comps = SimpleJson.Array();
            foreach (var comp in go.GetComponents<Component>())
            {
                if (comp == null) continue;
                comps.Add(comp.GetType().FullName);
            }
            obj.PutRaw("components", comps.ToString());

            if (go.transform.childCount > 0)
            {
                var children = SimpleJson.Array();
                for (int i = 0; i < go.transform.childCount; i++)
                {
                    var child = go.transform.GetChild(i).gameObject;
                    children.AddRaw(BuildHierarchyResult(child));
                }
                obj.PutRaw("children", children.ToString());
            }

            return obj.ToString();
        }

        static float GetFloat(Dictionary<string, object> dict, string key)
        {
            if (!dict.TryGetValue(key, out object val)) return 0f;
            if (val is double d) return (float)d;
            if (val is float f) return f;
            if (val is int i) return i;
            if (val is long l) return l;
            return 0f;
        }

        static string GetGameObjectPath(GameObject go) => PropertyOps.GetScenePath(go);
    }
}
