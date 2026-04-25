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
        /// <summary>
        /// Read the parent scene path from args. The canonical key is
        /// <c>parentPath</c>; <c>parent</c> is accepted as an alias because agents
        /// (and humans) reach for it naturally, and a silent-ignore placed the
        /// GameObject at scene root with no error. Warns on alias use so the
        /// agent learns the canonical form.
        /// </summary>
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

        /// <summary>
        /// Create a new empty GameObject in the active scene.
        /// Args: { name: "ObjectName", parentPath?: "/Canvas/Panel", scene?: "SceneName" }
        /// </summary>
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

        /// <summary>
        /// Rename a GameObject in scene or within a prefab.
        /// Scene: { sceneObjectPath: "OldName", newName: "NewName" }
        /// Prefab: { assetPath: "X.prefab", childPath?: "Child", newName: "NewName" }
        /// </summary>
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

            // Prefab
            string assetPath = AssetOps.ResolveAssetPath(args);
            if (assetPath == null)
                return CommandResult.Fail("Provide 'sceneObjectPath' or 'assetPath'.");

            string childPath = SimpleJson.GetString(args, "childPath");

            if (!assetPath.EndsWith(".prefab", StringComparison.OrdinalIgnoreCase))
            {
                // Rename asset file
                string error = AssetDatabase.RenameAsset(assetPath, newName);
                if (!string.IsNullOrEmpty(error))
                    return CommandResult.Fail($"Failed to rename asset: {error}");
                return CommandResult.Ok(SimpleJson.Object()
                    .Put("renamed", true).Put("assetPath", assetPath).Put("newName", newName).ToString());
            }

            if (string.IsNullOrEmpty(childPath))
            {
                // Rename the prefab asset file itself
                string error = AssetDatabase.RenameAsset(assetPath, newName);
                if (!string.IsNullOrEmpty(error))
                    return CommandResult.Fail($"Failed to rename prefab: {error}");
                return CommandResult.Ok(SimpleJson.Object()
                    .Put("renamed", true).Put("assetPath", assetPath).Put("newName", newName).ToString());
            }

            // Rename a child inside a prefab
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

        /// <summary>
        /// Duplicate a GameObject in scene or within a prefab.
        /// Scene: { sceneObjectPath: "MyObject", newName?: "MyObject (Copy)" }
        /// Prefab child: { assetPath: "X.prefab", childPath: "Child", newName?: "Child (Copy)" }
        /// Asset: { assetPath: "X.prefab", newName?: "X_Copy" } (duplicates the whole asset file)
        /// </summary>
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

            // Duplicate a child inside a prefab
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

            // Duplicate the asset file
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

        /// <summary>
        /// Reparent a GameObject under a new parent. Two modes:
        ///
        /// Scene mode:
        ///   { sceneObjectPath: "/Old/Path/Target",
        ///     newParentPath?: "/New/Parent",   // omit / null / "" → move to scene root
        ///     keepWorldSpace?: bool,           // default false (preserve local transform under new parent)
        ///     siblingIndex?: int }             // optional: place at this sibling slot under new parent
        ///
        /// Prefab mode (paths are relative to the prefab root):
        ///   { assetPath: "Assets/Prefabs/Enemy.prefab",
        ///     childPath: "Visuals/Body",       // the GO to move (required for prefab mode)
        ///     newParentPath?: "Bones/Root",    // new parent inside prefab; omit / "" → prefab root
        ///     keepWorldSpace?: bool,           // default false
        ///     siblingIndex?: int }
        ///
        /// Use case: take a GameObject that owns a SpriteRenderer and move it
        /// under a different parent without losing its components or wiring.
        /// Equivalent to drag-and-drop in Unity's Hierarchy/Prefab Mode window,
        /// but driven from the CLI.
        /// </summary>
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

            // Resolve the new parent. Empty/null → scene root.
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
            // SetTransformParent's worldPositionStays defaults to true; explicitly enforce
            // the user's choice via SetParent right after, since SetTransformParent doesn't
            // expose that flag in all Unity versions.
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

            // Edit prefab contents in isolation, save back via SaveAsPrefabAsset.
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
                    // Move to the prefab root.
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

        /// <summary>Path of <paramref name="t"/> relative to <paramref name="root"/>, or "" if t == root.</summary>
        static string GetPrefabRelativePath(Transform t, Transform root)
        {
            if (t == null || t == root) return "";
            var stack = new System.Collections.Generic.List<string>();
            for (var cur = t; cur != null && cur != root; cur = cur.parent)
                stack.Add(cur.name);
            stack.Reverse();
            return string.Join("/", stack);
        }

        /// <summary>
        /// Delete a GameObject from the scene or from within a prefab.
        /// Scene: { sceneObjectPath: "Canvas/Panel/OldButton" }
        /// Prefab: { assetPath: "X.prefab", childPath: "OldChild" }
        /// Children are always destroyed with the parent (Unity default behavior).
        /// </summary>
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

            // Prefab child deletion
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

        /// <summary>
        /// Inspect the scene hierarchy.
        /// Args: { scene?: "SceneName" }
        /// </summary>
        public static CommandResult InspectHierarchy(Dictionary<string, object> args)
        {
            string sceneName = SimpleJson.GetString(args, "scene");

            Scene scene;
            if (!string.IsNullOrEmpty(sceneName))
            {
                scene = SceneManager.GetSceneByName(sceneName);
                if (!scene.IsValid() || !scene.isLoaded)
                {
                    // Try by path
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
                rootArr.AddRaw(BuildGameObjectInfo(root, includeChildren: true));
            }

            var json = SimpleJson.Object()
                .Put("scene", scene.name)
                .Put("scenePath", scene.path)
                .Put("rootObjectCount", rootObjects.Length)
                .PutRaw("rootObjects", rootArr.ToString())
                .ToString();

            return CommandResult.Ok(json);
        }

        /// <summary>
        /// Instantiate a prefab into the active scene.
        /// Args: { assetPath?: "path", guid?: "guid", name?: "override", parentPath?: "/Parent",
        ///         position?: {x,y,z}, rotation?: {x,y,z} }
        /// </summary>
        public static CommandResult InstantiatePrefab(Dictionary<string, object> args)
        {
            string assetPath = AssetOps.ResolveAssetPath(args);
            if (assetPath == null)
                return CommandResult.Fail("Prefab not found. Provide 'assetPath' or 'guid'.");

            var prefab = AssetDatabase.LoadMainAssetAtPath(assetPath) as GameObject;
            if (prefab == null)
                return CommandResult.Fail($"Asset at '{assetPath}' is not a GameObject/Prefab.");

            // Instantiate as prefab instance (maintains prefab link)
            var instance = PrefabUtility.InstantiatePrefab(prefab) as GameObject;
            if (instance == null)
                return CommandResult.Fail($"Failed to instantiate prefab: {assetPath}");

            Undo.RegisterCreatedObjectUndo(instance, $"Instantiate {prefab.name}");

            // Optional name override
            string nameOverride = SimpleJson.GetString(args, "name");
            if (!string.IsNullOrEmpty(nameOverride))
                instance.name = nameOverride;

            // Optional parent
            string parentPath = ResolveParentPath(args);
            if (!string.IsNullOrEmpty(parentPath))
            {
                var parent = PropertyOps.FindSceneObject(parentPath, out string parentError);
                if (parent != null)
                    instance.transform.SetParent(parent.transform, false);
                else
                    DreamerLog.Warn($"Parent not found: {parentPath} ({parentError}), placing at root.");
            }

            // Optional position
            if (args.TryGetValue("position", out object posObj) && posObj is Dictionary<string, object> posDict)
            {
                instance.transform.position = new Vector3(
                    GetFloat(posDict, "x"), GetFloat(posDict, "y"), GetFloat(posDict, "z"));
            }

            // Optional rotation (euler angles)
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

        /// <summary>
        /// Create a new scene.
        /// Args: { name: "Level2", path?: "Assets/Scenes", setActive?: true }
        /// </summary>
        public static CommandResult CreateScene(Dictionary<string, object> args)
        {
            string name = SimpleJson.GetString(args, "name");
            if (string.IsNullOrEmpty(name))
                return CommandResult.Fail("'name' is required.");

            string folder = SimpleJson.GetString(args, "path", "Assets/Scenes");
            bool setActive = SimpleJson.GetBool(args, "setActive", true);

            // Ensure directory exists
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

        /// <summary>
        /// Open an existing scene.
        /// Args: { path: "Assets/Scenes/Level2.unity", mode?: "single"|"additive" }
        /// </summary>
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

        /// <summary>
        /// Save the current scene or a specific scene.
        /// Args: { path?: "Assets/Scenes/Level2.unity" }
        /// </summary>
        public static CommandResult SaveScene(Dictionary<string, object> args)
        {
            string scenePath = SimpleJson.GetString(args, "path");

            if (!string.IsNullOrEmpty(scenePath))
            {
                // Save a specific scene by path
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
                // Save all open scenes
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

        /// <summary>
        /// Create a hierarchy of GameObjects with components.
        /// Scene mode (default): { name, components?, children? }
        /// Prefab mode: { name, components?, children?, savePath: "Assets/Prefabs" }
        ///   When savePath is provided, builds the hierarchy, saves as prefab, destroys the temp object.
        /// </summary>
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

            // Prefab mode: save as prefab and destroy the temp scene object
            if (!string.IsNullOrEmpty(savePath))
            {
                // Ensure directory exists
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

            // Scene mode: keep in scene
            Undo.RegisterCreatedObjectUndo(go, $"Create hierarchy {name}");

            // Build the standard result, then splice warnings in before returning.
            string resultJson = BuildHierarchyResult(go);
            // Quick-and-safe: re-parse-and-extend is overkill. Instead, wrap by
            // string-replacing the final '}' with ",warnings":[...]"}" only when
            // we have something to report. Keeps the happy-path output identical.
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

        /// <summary>
        /// Build a GameObject + its components and recurse children. Component failures
        /// are RECORDED into <paramref name="warnings"/> instead of being silently
        /// dropped — the old behavior let one unresolved type mask the entire gap in
        /// the hierarchy, which was especially bad during script compile errors.
        /// </summary>
        static GameObject CreateNode(Dictionary<string, object> nodeArgs, Transform parent, List<string> warnings)
        {
            string name = SimpleJson.GetString(nodeArgs, "name", "GameObject");
            var go = new GameObject(name);
            string pathHint = parent == null ? "/" + name : parent.name + "/" + name;

            if (parent != null)
                go.transform.SetParent(parent, false);

            // Add components
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

                    // Skip Transform — already present (expected, not a warning)
                    if (compType == typeof(Transform) || compType == typeof(RectTransform)) continue;

                    if (go.GetComponent(compType) != null)
                    {
                        warnings.Add($"[{pathHint}] Component '{typeName}' already present — skipped duplicate.");
                        continue;
                    }

                    go.AddComponent(compType);
                }
            }

            // Create children recursively
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

            // Components
            var comps = SimpleJson.Array();
            foreach (var comp in go.GetComponents<Component>())
            {
                if (comp == null) continue;
                comps.Add(comp.GetType().FullName);
            }
            obj.PutRaw("components", comps.ToString());

            // Children
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

        // ── Helpers ──

        static string BuildGameObjectInfo(GameObject go, bool includeChildren)
        {
            var obj = SimpleJson.Object()
                .Put("name", go.name)
                .Put("instanceId", go.GetInstanceID())
                .Put("active", go.activeSelf)
                .Put("tag", go.tag)
                .Put("layer", go.layer)
                .Put("isStatic", go.isStatic);

            // Components
            var comps = SimpleJson.Array();
            foreach (var comp in go.GetComponents<Component>())
            {
                if (comp == null) continue; // Missing script
                comps.AddRaw(SimpleJson.Object()
                    .Put("type", comp.GetType().Name)
                    .Put("fullType", comp.GetType().FullName)
                    .Put("enabled", IsEnabled(comp))
                    .ToString());
            }
            obj.PutRaw("components", comps.ToString());

            // Children (1 level deep)
            if (includeChildren && go.transform.childCount > 0)
            {
                var children = SimpleJson.Array();
                for (int i = 0; i < go.transform.childCount; i++)
                {
                    var child = go.transform.GetChild(i).gameObject;
                    children.AddRaw(BuildGameObjectInfo(child, includeChildren: false));
                }
                obj.PutRaw("children", children.ToString());
            }
            else
            {
                obj.Put("childCount", go.transform.childCount);
            }

            return obj.ToString();
        }

        static bool IsEnabled(Component comp)
        {
            if (comp is Behaviour b) return b.enabled;
            if (comp is Renderer r) return r.enabled;
            if (comp is Collider c) return c.enabled;
            return true;
        }

        // Note: scene-object path resolution is shared via PropertyOps.FindSceneObject,
        // which supports multi-scene, recursive descendant search, and ambiguity detection.

        static string GetGameObjectPath(GameObject go) => PropertyOps.GetScenePath(go);
    }
}
