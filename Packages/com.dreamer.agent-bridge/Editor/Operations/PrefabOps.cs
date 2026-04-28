using System;
using System.Collections.Generic;
using System.IO;
using UnityEditor;
using UnityEngine;

namespace Dreamer.AgentBridge
{
    public static class PrefabOps
    {
        /// <summary>Unload prefab-contents without letting cleanup override the caller's outcome. After SaveAsPrefabAsset Unity may have torn down the backing scene, so UnloadPrefabContents throws "Specified object is not part of Prefab contents" despite the save succeeding. Every prefab-editing op should use this in its finally block.</summary>
        public static void SafeUnloadPrefabContents(GameObject prefabRoot)
        {
            if (prefabRoot == null) return;
            try
            {
                PrefabUtility.UnloadPrefabContents(prefabRoot);
            }
            catch (Exception ex)
            {
                DreamerLog.Warn($"SafeUnloadPrefabContents: ignored cleanup error ({ex.GetType().Name}: {ex.Message}). The prefab mutation itself was not affected.");
            }
        }


        /// <summary>Create a new empty prefab. Args: { name, path? }</summary>
        public static CommandResult CreatePrefab(Dictionary<string, object> args)
        {
            string name = SimpleJson.GetString(args, "name");
            if (string.IsNullOrEmpty(name))
                return CommandResult.Fail("'name' is required.");

            string folder = SimpleJson.GetString(args, "path", "Assets/Prefabs");

            name = SanitizeFileName(name);
            if (name.EndsWith(".prefab", StringComparison.OrdinalIgnoreCase))
                name = name.Substring(0, name.Length - 7);

            string fullDir = Path.GetFullPath(folder);
            if (!Directory.Exists(fullDir))
            {
                Directory.CreateDirectory(fullDir);
                AssetDatabase.Refresh();
            }

            string assetPath = $"{folder}/{name}.prefab";

            if (File.Exists(Path.GetFullPath(assetPath)))
                return CommandResult.Fail($"Prefab already exists at: {assetPath}");

            var tempGo = new GameObject(name);
            try
            {
                var prefab = PrefabUtility.SaveAsPrefabAsset(tempGo, assetPath, out bool success);
                if (!success || prefab == null)
                    return CommandResult.Fail($"Failed to save prefab at: {assetPath}");
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(tempGo);
            }

            string guid = AssetDatabase.AssetPathToGUID(assetPath);

            var json = SimpleJson.Object()
                .Put("path", assetPath)
                .Put("guid", guid)
                .Put("name", name)
                .Put("created", true)
                .ToString();

            return CommandResult.Ok(json);
        }

        /// <summary>Add a child GameObject to an existing prefab. Args: { assetPath?, guid?, childName, parentPath? }</summary>
        public static CommandResult AddChildToPrefab(Dictionary<string, object> args)
        {
            string assetPath = AssetOps.ResolveAssetPath(args);
            if (assetPath == null)
                return CommandResult.Fail("Prefab not found. Provide a valid 'assetPath' or 'guid'.");

            if (!assetPath.EndsWith(".prefab", StringComparison.OrdinalIgnoreCase))
                return CommandResult.Fail($"Asset is not a prefab: {assetPath}");

            string childName = SimpleJson.GetString(args, "childName");
            if (string.IsNullOrEmpty(childName))
                return CommandResult.Fail("'childName' is required.");

            string parentPath = SimpleJson.GetString(args, "parentPath");

            var prefabRoot = PrefabUtility.LoadPrefabContents(assetPath);
            if (prefabRoot == null)
                return CommandResult.Fail($"Failed to load prefab contents: {assetPath}");

            string childPath;
            try
            {
                Transform parent = prefabRoot.transform;

                if (!string.IsNullOrEmpty(parentPath))
                {
                    string searchPath = parentPath.StartsWith("/") ? parentPath.Substring(1) : parentPath;
                    Transform found = prefabRoot.transform.Find(searchPath);
                    if (found == null)
                    {
                        SafeUnloadPrefabContents(prefabRoot);
                        return CommandResult.Fail($"Parent path not found within prefab: {parentPath}");
                    }
                    parent = found;
                }

                var child = new GameObject(childName);
                child.transform.SetParent(parent, false);

                childPath = GetRelativePath(prefabRoot.transform, child.transform);

                PrefabUtility.SaveAsPrefabAsset(prefabRoot, assetPath);
            }
            finally
            {
                SafeUnloadPrefabContents(prefabRoot);
            }

            var json = SimpleJson.Object()
                .Put("name", childName)
                .Put("path", childPath)
                .Put("assetPath", assetPath)
                .Put("added", true)
                .ToString();

            return CommandResult.Ok(json);
        }

        /// <summary>Save a scene object as a new prefab. Args: { sceneObjectPath, savePath?, name? }</summary>
        public static CommandResult SaveAsPrefab(Dictionary<string, object> args)
        {
            string sceneObjectPath = SimpleJson.GetString(args, "sceneObjectPath");
            if (string.IsNullOrEmpty(sceneObjectPath))
                return CommandResult.Fail("'sceneObjectPath' is required.");

            var go = PropertyOps.FindSceneObject(sceneObjectPath, out string findError);
            if (go == null)
                return CommandResult.Fail(findError ?? $"Scene object not found at path: {sceneObjectPath}");

            string folder = SimpleJson.GetString(args, "savePath", "Assets/Prefabs");
            string name = SimpleJson.GetString(args, "name");
            if (string.IsNullOrEmpty(name))
                name = go.name;

            name = SanitizeFileName(name);
            if (name.EndsWith(".prefab", StringComparison.OrdinalIgnoreCase))
                name = name.Substring(0, name.Length - 7);

            string fullDir = Path.GetFullPath(folder);
            if (!Directory.Exists(fullDir))
            {
                Directory.CreateDirectory(fullDir);
                AssetDatabase.Refresh();
            }

            string assetPath = $"{folder}/{name}.prefab";

            var prefab = PrefabUtility.SaveAsPrefabAssetAndConnect(go, assetPath, InteractionMode.UserAction, out bool success);
            if (!success || prefab == null)
                return CommandResult.Fail($"Failed to save prefab at: {assetPath}");

            string guid = AssetDatabase.AssetPathToGUID(assetPath);

            var json = SimpleJson.Object()
                .Put("path", assetPath)
                .Put("guid", guid)
                .Put("name", name)
                .Put("saved", true)
                .ToString();

            return CommandResult.Ok(json);
        }

        static string SanitizeFileName(string name)
        {
            foreach (char c in Path.GetInvalidFileNameChars())
                name = name.Replace(c, '_');
            return name;
        }

        static string GetRelativePath(Transform root, Transform target)
        {
            string path = target.name;
            Transform current = target.parent;
            while (current != null && current != root)
            {
                path = current.name + "/" + path;
                current = current.parent;
            }
            return path;
        }
    }
}
