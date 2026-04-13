using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using UnityEditor;
using UnityEngine;

namespace Dreamer.AgentBridge
{
    public static class ComponentOps
    {
        /// <summary>
        /// Add a component to a prefab.
        /// Args: { assetPath?: "path", guid?: "guid", typeName: "FullTypeName" }
        /// </summary>
        public static CommandResult AddComponent(Dictionary<string, object> args)
        {
            string assetPath = AssetOps.ResolveAssetPath(args);
            if (assetPath == null)
                return CommandResult.Fail("Asset not found. Provide a valid 'assetPath' or 'guid'.");

            if (!assetPath.EndsWith(".prefab", StringComparison.OrdinalIgnoreCase))
                return CommandResult.Fail($"Asset is not a prefab: {assetPath}");

            string typeName = SimpleJson.GetString(args, "typeName");
            if (string.IsNullOrEmpty(typeName))
                return CommandResult.Fail("'typeName' is required.");

            Type componentType = ResolveType(typeName);
            if (componentType == null)
                return CommandResult.Fail($"Type not found: {typeName}. Use the full type name (e.g. 'UnityEngine.BoxCollider').");

            if (!typeof(Component).IsAssignableFrom(componentType))
                return CommandResult.Fail($"Type '{typeName}' is not a Component.");

            // Edit prefab contents
            var prefabRoot = PrefabUtility.LoadPrefabContents(assetPath);
            if (prefabRoot == null)
                return CommandResult.Fail($"Failed to load prefab contents: {assetPath}");

            try
            {
                // Check if component already exists
                if (prefabRoot.GetComponent(componentType) != null)
                {
                    PrefabUtility.UnloadPrefabContents(prefabRoot);
                    return CommandResult.Fail($"Component '{componentType.Name}' already exists on prefab root.");
                }

                prefabRoot.AddComponent(componentType);
                PrefabUtility.SaveAsPrefabAsset(prefabRoot, assetPath);
            }
            finally
            {
                PrefabUtility.UnloadPrefabContents(prefabRoot);
            }

            var json = SimpleJson.Object()
                .Put("added", true)
                .Put("typeName", componentType.FullName)
                .Put("assetPath", assetPath)
                .ToString();

            return CommandResult.Ok(json);
        }

        /// <summary>
        /// Remove a component from a prefab.
        /// Args: { assetPath?: "path", guid?: "guid", typeName: "FullTypeName" }
        /// </summary>
        public static CommandResult RemoveComponent(Dictionary<string, object> args)
        {
            string assetPath = AssetOps.ResolveAssetPath(args);
            if (assetPath == null)
                return CommandResult.Fail("Asset not found. Provide a valid 'assetPath' or 'guid'.");

            if (!assetPath.EndsWith(".prefab", StringComparison.OrdinalIgnoreCase))
                return CommandResult.Fail($"Asset is not a prefab: {assetPath}");

            string typeName = SimpleJson.GetString(args, "typeName");
            if (string.IsNullOrEmpty(typeName))
                return CommandResult.Fail("'typeName' is required.");

            Type componentType = ResolveType(typeName);
            if (componentType == null)
                return CommandResult.Fail($"Type not found: {typeName}");

            var prefabRoot = PrefabUtility.LoadPrefabContents(assetPath);
            if (prefabRoot == null)
                return CommandResult.Fail($"Failed to load prefab contents: {assetPath}");

            try
            {
                var comp = prefabRoot.GetComponent(componentType);
                if (comp == null)
                {
                    PrefabUtility.UnloadPrefabContents(prefabRoot);
                    return CommandResult.Fail($"Component '{componentType.Name}' not found on prefab root.");
                }

                // Don't allow removing Transform
                if (componentType == typeof(Transform) || componentType == typeof(RectTransform))
                {
                    PrefabUtility.UnloadPrefabContents(prefabRoot);
                    return CommandResult.Fail("Cannot remove Transform component.");
                }

                UnityEngine.Object.DestroyImmediate(comp);
                PrefabUtility.SaveAsPrefabAsset(prefabRoot, assetPath);
            }
            finally
            {
                PrefabUtility.UnloadPrefabContents(prefabRoot);
            }

            var json = SimpleJson.Object()
                .Put("removed", true)
                .Put("typeName", componentType.FullName)
                .Put("assetPath", assetPath)
                .ToString();

            return CommandResult.Ok(json);
        }

        /// <summary>
        /// Resolve a type by name across all loaded assemblies.
        /// </summary>
        public static Type ResolveType(string typeName)
        {
            if (string.IsNullOrEmpty(typeName)) return null;

            // Try direct Type.GetType first
            Type t = Type.GetType(typeName);
            if (t != null) return t;

            // Search all assemblies
            foreach (var asm in AppDomain.CurrentDomain.GetAssemblies())
            {
                try
                {
                    t = asm.GetTypes().FirstOrDefault(
                        type => type.FullName == typeName || type.Name == typeName);
                    if (t != null) return t;
                }
                catch (ReflectionTypeLoadException)
                {
                    // Some assemblies may fail to enumerate types — skip
                }
            }

            return null;
        }
    }
}
