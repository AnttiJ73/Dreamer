using System;
using System.Collections.Generic;
using System.IO;
using UnityEditor;
using UnityEngine;

namespace Dreamer.AgentBridge
{
    public static class PrefabOps
    {
        /// <summary>
        /// Create a new empty prefab.
        /// Args: { name: "MyPrefab", path?: "Assets/Prefabs" }
        /// </summary>
        public static CommandResult CreatePrefab(Dictionary<string, object> args)
        {
            string name = SimpleJson.GetString(args, "name");
            if (string.IsNullOrEmpty(name))
                return CommandResult.Fail("'name' is required.");

            string folder = SimpleJson.GetString(args, "path", "Assets/Prefabs");

            // Sanitize name
            name = SanitizeFileName(name);
            if (name.EndsWith(".prefab", StringComparison.OrdinalIgnoreCase))
                name = name.Substring(0, name.Length - 7);

            // Ensure directory exists
            string fullDir = Path.GetFullPath(folder);
            if (!Directory.Exists(fullDir))
            {
                Directory.CreateDirectory(fullDir);
                AssetDatabase.Refresh();
            }

            string assetPath = $"{folder}/{name}.prefab";

            // Don't overwrite existing
            if (File.Exists(Path.GetFullPath(assetPath)))
                return CommandResult.Fail($"Prefab already exists at: {assetPath}");

            // Create temporary GameObject, save as prefab, destroy temp
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

        static string SanitizeFileName(string name)
        {
            foreach (char c in Path.GetInvalidFileNameChars())
                name = name.Replace(c, '_');
            return name;
        }
    }
}
