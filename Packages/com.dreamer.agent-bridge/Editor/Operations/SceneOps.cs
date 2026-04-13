using System;
using System.Collections.Generic;
using UnityEditor;
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
