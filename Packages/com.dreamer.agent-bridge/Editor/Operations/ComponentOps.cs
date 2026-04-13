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
        /// Add a component to a prefab or scene object.
        /// Args: { assetPath?: "path", guid?: "guid", sceneObjectPath?: "/MyObject", typeName: "FullTypeName" }
        /// </summary>
        public static CommandResult AddComponent(Dictionary<string, object> args)
        {
            string typeName = SimpleJson.GetString(args, "typeName");
            if (string.IsNullOrEmpty(typeName))
                return CommandResult.Fail("'typeName' is required.");

            Type componentType = ResolveType(typeName);
            if (componentType == null)
                return CommandResult.Fail($"Type not found: {typeName}. Use the full type name (e.g. 'UnityEngine.BoxCollider').");

            if (!typeof(Component).IsAssignableFrom(componentType))
                return CommandResult.Fail($"Type '{typeName}' is not a Component.");

            // Scene object path takes priority
            string sceneObjectPath = SimpleJson.GetString(args, "sceneObjectPath");
            if (!string.IsNullOrEmpty(sceneObjectPath))
            {
                var go = PropertyOps.FindSceneObject(sceneObjectPath);
                if (go == null)
                    return CommandResult.Fail($"Scene object not found at path: {sceneObjectPath}");

                if (go.GetComponent(componentType) != null)
                    return CommandResult.Fail($"Component '{componentType.Name}' already exists on scene object.");

                Undo.AddComponent(go, componentType);
                EditorUtility.SetDirty(go);

                var json = SimpleJson.Object()
                    .Put("added", true)
                    .Put("typeName", componentType.FullName)
                    .Put("sceneObjectPath", sceneObjectPath)
                    .ToString();

                return CommandResult.Ok(json);
            }

            // Fall through to prefab logic
            string assetPath = AssetOps.ResolveAssetPath(args);
            if (assetPath == null)
                return CommandResult.Fail("Target not found. Provide 'assetPath', 'guid', or 'sceneObjectPath'.");

            if (!assetPath.EndsWith(".prefab", StringComparison.OrdinalIgnoreCase))
                return CommandResult.Fail($"Asset is not a prefab: {assetPath}");

            // Edit prefab contents
            var prefabRoot = PrefabUtility.LoadPrefabContents(assetPath);
            if (prefabRoot == null)
                return CommandResult.Fail($"Failed to load prefab contents: {assetPath}");

            try
            {
                // Optional childPath — target a child within the prefab
                string childPath = SimpleJson.GetString(args, "childPath");
                GameObject target = prefabRoot;
                if (!string.IsNullOrEmpty(childPath))
                {
                    Transform child = prefabRoot.transform.Find(childPath);
                    if (child == null)
                    {
                        PrefabUtility.UnloadPrefabContents(prefabRoot);
                        return CommandResult.Fail($"Child '{childPath}' not found in prefab '{assetPath}'.");
                    }
                    target = child.gameObject;
                }

                if (target.GetComponent(componentType) != null)
                {
                    PrefabUtility.UnloadPrefabContents(prefabRoot);
                    return CommandResult.Fail($"Component '{componentType.Name}' already exists on '{target.name}'.");
                }

                target.AddComponent(componentType);
                PrefabUtility.SaveAsPrefabAsset(prefabRoot, assetPath);
            }
            finally
            {
                PrefabUtility.UnloadPrefabContents(prefabRoot);
            }

            var prefabJson = SimpleJson.Object()
                .Put("added", true)
                .Put("typeName", componentType.FullName)
                .Put("assetPath", assetPath)
                .ToString();

            return CommandResult.Ok(prefabJson);
        }

        /// <summary>
        /// Remove a component from a prefab or scene object.
        /// Args: { assetPath?: "path", guid?: "guid", sceneObjectPath?: "/MyObject", typeName: "FullTypeName" }
        /// </summary>
        public static CommandResult RemoveComponent(Dictionary<string, object> args)
        {
            string typeName = SimpleJson.GetString(args, "typeName");
            if (string.IsNullOrEmpty(typeName))
                return CommandResult.Fail("'typeName' is required.");

            Type componentType = ResolveType(typeName);
            if (componentType == null)
                return CommandResult.Fail($"Type not found: {typeName}");

            // Don't allow removing Transform
            if (componentType == typeof(Transform) || componentType == typeof(RectTransform))
                return CommandResult.Fail("Cannot remove Transform component.");

            // Scene object path takes priority
            string sceneObjectPath = SimpleJson.GetString(args, "sceneObjectPath");
            if (!string.IsNullOrEmpty(sceneObjectPath))
            {
                var go = PropertyOps.FindSceneObject(sceneObjectPath);
                if (go == null)
                    return CommandResult.Fail($"Scene object not found at path: {sceneObjectPath}");

                var comp = go.GetComponent(componentType);
                if (comp == null)
                    return CommandResult.Fail($"Component '{componentType.Name}' not found on scene object.");

                Undo.DestroyObjectImmediate(comp);
                EditorUtility.SetDirty(go);

                var json = SimpleJson.Object()
                    .Put("removed", true)
                    .Put("typeName", componentType.FullName)
                    .Put("sceneObjectPath", sceneObjectPath)
                    .ToString();

                return CommandResult.Ok(json);
            }

            // Fall through to prefab logic
            string assetPath = AssetOps.ResolveAssetPath(args);
            if (assetPath == null)
                return CommandResult.Fail("Target not found. Provide 'assetPath', 'guid', or 'sceneObjectPath'.");

            if (!assetPath.EndsWith(".prefab", StringComparison.OrdinalIgnoreCase))
                return CommandResult.Fail($"Asset is not a prefab: {assetPath}");

            var prefabRoot = PrefabUtility.LoadPrefabContents(assetPath);
            if (prefabRoot == null)
                return CommandResult.Fail($"Failed to load prefab contents: {assetPath}");

            try
            {
                // Optional childPath — target a child within the prefab
                string childPath = SimpleJson.GetString(args, "childPath");
                GameObject target = prefabRoot;
                if (!string.IsNullOrEmpty(childPath))
                {
                    Transform child = prefabRoot.transform.Find(childPath);
                    if (child == null)
                    {
                        PrefabUtility.UnloadPrefabContents(prefabRoot);
                        return CommandResult.Fail($"Child '{childPath}' not found in prefab '{assetPath}'.");
                    }
                    target = child.gameObject;
                }

                var prefabComp = target.GetComponent(componentType);
                if (prefabComp == null)
                {
                    PrefabUtility.UnloadPrefabContents(prefabRoot);
                    return CommandResult.Fail($"Component '{componentType.Name}' not found on '{target.name}'.");
                }

                UnityEngine.Object.DestroyImmediate(prefabComp);
                PrefabUtility.SaveAsPrefabAsset(prefabRoot, assetPath);
            }
            finally
            {
                PrefabUtility.UnloadPrefabContents(prefabRoot);
            }

            var prefabJson = SimpleJson.Object()
                .Put("removed", true)
                .Put("typeName", componentType.FullName)
                .Put("assetPath", assetPath)
                .ToString();

            return CommandResult.Ok(prefabJson);
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
