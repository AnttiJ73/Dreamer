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
        /// Create a new empty GameObject in the active scene.
        /// Args: { name: "ObjectName", parentPath?: "/Canvas/Panel", scene?: "SceneName" }
        /// </summary>
        public static CommandResult CreateGameObject(Dictionary<string, object> args)
        {
            string name = SimpleJson.GetString(args, "name", "GameObject");
            string parentPath = SimpleJson.GetString(args, "parentPath");

            var go = new GameObject(name);
            Undo.RegisterCreatedObjectUndo(go, $"Create {name}");

            if (!string.IsNullOrEmpty(parentPath))
            {
                var parent = FindByPath(parentPath);
                if (parent == null)
                {
                    UnityEngine.Object.DestroyImmediate(go);
                    return CommandResult.Fail($"Parent not found at path: {parentPath}");
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
                var go = FindByPath(sceneObjectPath);
                if (go == null)
                    return CommandResult.Fail($"Scene object not found at path: {sceneObjectPath}");

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
                    PrefabUtility.UnloadPrefabContents(prefabRoot);
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
                PrefabUtility.UnloadPrefabContents(prefabRoot);
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
            string parentPath = SimpleJson.GetString(args, "parentPath");
            if (!string.IsNullOrEmpty(parentPath))
            {
                var parent = FindByPath(parentPath);
                if (parent != null)
                    instance.transform.SetParent(parent.transform, false);
                else
                    Debug.LogWarning($"[AgentBridge] Parent not found: {parentPath}, placing at root.");
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
            string parentPath = SimpleJson.GetString(args, "parentPath");

            Transform parent = null;
            if (!string.IsNullOrEmpty(parentPath))
            {
                var parentGo = FindByPath(parentPath);
                if (parentGo == null)
                    return CommandResult.Fail($"Parent not found at path: {parentPath}");
                parent = parentGo.transform;
            }

            var go = CreateNode(args, parent);
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
                    .ToString();
                return CommandResult.Ok(prefabJson);
            }

            // Scene mode: keep in scene
            Undo.RegisterCreatedObjectUndo(go, $"Create hierarchy {name}");

            var json = BuildHierarchyResult(go);
            return CommandResult.Ok(json);
        }

        static GameObject CreateNode(Dictionary<string, object> nodeArgs, Transform parent)
        {
            string name = SimpleJson.GetString(nodeArgs, "name", "GameObject");
            var go = new GameObject(name);

            if (parent != null)
                go.transform.SetParent(parent, false);

            // Add components
            if (nodeArgs.TryGetValue("components", out object compsObj) && compsObj is List<object> compList)
            {
                foreach (var compEntry in compList)
                {
                    string typeName = compEntry as string;
                    if (string.IsNullOrEmpty(typeName)) continue;

                    Type compType = ComponentOps.ResolveType(typeName);
                    if (compType == null || !typeof(Component).IsAssignableFrom(compType)) continue;

                    // Skip Transform — already present
                    if (compType == typeof(Transform) || compType == typeof(RectTransform)) continue;

                    if (go.GetComponent(compType) == null)
                        go.AddComponent(compType);
                }
            }

            // Create children recursively
            if (nodeArgs.TryGetValue("children", out object childrenObj) && childrenObj is List<object> childList)
            {
                foreach (var childEntry in childList)
                {
                    if (childEntry is Dictionary<string, object> childArgs)
                        CreateNode(childArgs, go.transform);
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

        /// <summary>
        /// Find a GameObject by hierarchy path (e.g. "/Canvas/Panel/Button").
        /// Leading "/" is optional.
        /// </summary>
        static GameObject FindByPath(string path)
        {
            if (string.IsNullOrEmpty(path)) return null;

            // Strip leading /
            if (path.StartsWith("/"))
                path = path.Substring(1);

            string[] parts = path.Split('/');
            if (parts.Length == 0) return null;

            // Find root object
            var scene = SceneManager.GetActiveScene();
            var roots = scene.GetRootGameObjects();
            GameObject current = null;

            foreach (var root in roots)
            {
                if (root.name == parts[0])
                {
                    current = root;
                    break;
                }
            }

            if (current == null) return null;

            // Traverse children
            for (int i = 1; i < parts.Length; i++)
            {
                Transform child = current.transform.Find(parts[i]);
                if (child == null) return null;
                current = child.gameObject;
            }

            return current;
        }

        static string GetGameObjectPath(GameObject go)
        {
            string path = go.name;
            Transform parent = go.transform.parent;
            while (parent != null)
            {
                path = parent.name + "/" + path;
                parent = parent.parent;
            }
            return "/" + path;
        }
    }
}
