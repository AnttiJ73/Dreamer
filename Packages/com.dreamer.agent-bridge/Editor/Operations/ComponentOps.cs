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
        /// <summary>Add a component to a prefab or scene object. Args: { assetPath?, guid?, sceneObjectPath?, typeName }</summary>
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

            string sceneObjectPath = SimpleJson.GetString(args, "sceneObjectPath");
            if (!string.IsNullOrEmpty(sceneObjectPath))
            {
                var go = PropertyOps.FindSceneObject(sceneObjectPath, out string findError);
                if (go == null)
                    return CommandResult.Fail(findError ?? $"Scene object not found at path: {sceneObjectPath}");

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
                string childPath = SimpleJson.GetString(args, "childPath");
                GameObject target = prefabRoot;
                if (!string.IsNullOrEmpty(childPath))
                {
                    Transform child = prefabRoot.transform.Find(childPath);
                    if (child == null)
                    {
                        PrefabOps.SafeUnloadPrefabContents(prefabRoot);
                        return CommandResult.Fail($"Child '{childPath}' not found in prefab '{assetPath}'.");
                    }
                    target = child.gameObject;
                }

                if (target.GetComponent(componentType) != null)
                {
                    PrefabOps.SafeUnloadPrefabContents(prefabRoot);
                    return CommandResult.Fail($"Component '{componentType.Name}' already exists on '{target.name}'.");
                }

                target.AddComponent(componentType);
                PrefabUtility.SaveAsPrefabAsset(prefabRoot, assetPath);
            }
            finally
            {
                PrefabOps.SafeUnloadPrefabContents(prefabRoot);
            }

            var prefabJson = SimpleJson.Object()
                .Put("added", true)
                .Put("typeName", componentType.FullName)
                .Put("assetPath", assetPath)
                .ToString();

            return CommandResult.Ok(prefabJson);
        }

        /// <summary>Remove a component from a prefab or scene object. Args: { assetPath?, guid?, sceneObjectPath?, typeName }</summary>
        public static CommandResult RemoveComponent(Dictionary<string, object> args)
        {
            string typeName = SimpleJson.GetString(args, "typeName");
            if (string.IsNullOrEmpty(typeName))
                return CommandResult.Fail("'typeName' is required.");

            Type componentType = ResolveType(typeName);
            if (componentType == null)
                return CommandResult.Fail($"Type not found: {typeName}");

            if (componentType == typeof(Transform) || componentType == typeof(RectTransform))
                return CommandResult.Fail("Cannot remove Transform component.");

            string sceneObjectPath = SimpleJson.GetString(args, "sceneObjectPath");
            if (!string.IsNullOrEmpty(sceneObjectPath))
            {
                var go = PropertyOps.FindSceneObject(sceneObjectPath, out string findError);
                if (go == null)
                    return CommandResult.Fail(findError ?? $"Scene object not found at path: {sceneObjectPath}");

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
                string childPath = SimpleJson.GetString(args, "childPath");
                GameObject target = prefabRoot;
                if (!string.IsNullOrEmpty(childPath))
                {
                    Transform child = prefabRoot.transform.Find(childPath);
                    if (child == null)
                    {
                        PrefabOps.SafeUnloadPrefabContents(prefabRoot);
                        return CommandResult.Fail($"Child '{childPath}' not found in prefab '{assetPath}'.");
                    }
                    target = child.gameObject;
                }

                var prefabComp = target.GetComponent(componentType);
                if (prefabComp == null)
                {
                    PrefabOps.SafeUnloadPrefabContents(prefabRoot);
                    return CommandResult.Fail($"Component '{componentType.Name}' not found on '{target.name}'.");
                }

                UnityEngine.Object.DestroyImmediate(prefabComp);
                PrefabUtility.SaveAsPrefabAsset(prefabRoot, assetPath);
            }
            finally
            {
                PrefabOps.SafeUnloadPrefabContents(prefabRoot);
            }

            var prefabJson = SimpleJson.Object()
                .Put("removed", true)
                .Put("typeName", componentType.FullName)
                .Put("assetPath", assetPath)
                .ToString();

            return CommandResult.Ok(prefabJson);
        }

        /// <summary>Scrub "Missing (Mono Script)" component orphans left after a script is deleted. These are invisible to GetComponent&lt;T&gt; and only removable via GameObjectUtility.RemoveMonoBehavioursWithMissingScript. Targets: prefab, scene object, or folder.</summary>
        public static CommandResult RemoveMissingScripts(Dictionary<string, object> args)
        {
            bool recursive = !args.ContainsKey("recursive") || SimpleJson.GetBool(args, "recursive", true);
            bool dryRun = SimpleJson.GetBool(args, "dryRun", false);

            string sceneObjectPath = SimpleJson.GetString(args, "sceneObjectPath");
            if (!string.IsNullOrEmpty(sceneObjectPath))
            {
                var go = PropertyOps.FindSceneObject(sceneObjectPath, out string findError);
                if (go == null)
                    return CommandResult.Fail(findError ?? $"Scene object not found at path: {sceneObjectPath}");

                var affected = new List<ScrubEntry>();
                int total = WalkAndScrub(go, recursive, dryRun, affected);

                if (!dryRun && total > 0) EditorUtility.SetDirty(go);

                return CommandResult.Ok(SimpleJson.Object()
                    .Put("target", "sceneObject")
                    .Put("sceneObjectPath", sceneObjectPath)
                    .Put("totalRemoved", total)
                    .Put("dryRun", dryRun)
                    .PutRaw("affected", SerializeAffected(affected))
                    .ToString());
            }

            if (!string.IsNullOrEmpty(SimpleJson.GetString(args, "assetPath"))
                || !string.IsNullOrEmpty(SimpleJson.GetString(args, "guid")))
            {
                string assetPath = AssetOps.ResolveAssetPath(args);
                if (assetPath == null)
                    return CommandResult.Fail("Asset not found — check 'assetPath' or 'guid'.");
                if (!assetPath.EndsWith(".prefab", StringComparison.OrdinalIgnoreCase))
                    return CommandResult.Fail($"Asset is not a prefab: {assetPath}");

                return ScrubPrefab(assetPath, recursive, dryRun);
            }

            string folder = SimpleJson.GetString(args, "path");
            if (!string.IsNullOrEmpty(folder))
                return ScrubFolder(folder, recursive, dryRun);

            return CommandResult.Fail("Provide one of: 'assetPath'/'guid' (prefab), 'sceneObjectPath' (scene), or 'path' (folder scan).");
        }

        static CommandResult ScrubPrefab(string assetPath, bool recursive, bool dryRun)
        {
            var prefabRoot = PrefabUtility.LoadPrefabContents(assetPath);
            if (prefabRoot == null)
                return CommandResult.Fail($"Failed to load prefab contents: {assetPath}");

            try
            {
                var affected = new List<ScrubEntry>();
                int total = WalkAndScrub(prefabRoot, recursive, dryRun, affected);

                if (!dryRun && total > 0)
                    PrefabUtility.SaveAsPrefabAsset(prefabRoot, assetPath);

                return CommandResult.Ok(SimpleJson.Object()
                    .Put("target", "prefab")
                    .Put("assetPath", assetPath)
                    .Put("totalRemoved", total)
                    .Put("dryRun", dryRun)
                    .PutRaw("affected", SerializeAffected(affected))
                    .ToString());
            }
            finally
            {
                PrefabOps.SafeUnloadPrefabContents(prefabRoot);
            }
        }

        static CommandResult ScrubFolder(string folder, bool recursive, bool dryRun)
        {
            if (!AssetDatabase.IsValidFolder(folder))
                return CommandResult.Fail($"Not a valid asset folder: {folder}");

            string[] guids = AssetDatabase.FindAssets("t:Prefab", new[] { folder });
            var prefabSummaries = SimpleJson.Array();
            int grandTotal = 0;
            int cleanedPrefabs = 0;

            foreach (var guid in guids)
            {
                string path = AssetDatabase.GUIDToAssetPath(guid);
                var prefabRoot = PrefabUtility.LoadPrefabContents(path);
                if (prefabRoot == null) continue;

                try
                {
                    var affected = new List<ScrubEntry>();
                    int total = WalkAndScrub(prefabRoot, recursive, dryRun, affected);
                    if (total <= 0) continue;

                    grandTotal += total;
                    cleanedPrefabs++;
                    if (!dryRun)
                        PrefabUtility.SaveAsPrefabAsset(prefabRoot, path);

                    prefabSummaries.AddRaw(SimpleJson.Object()
                        .Put("assetPath", path)
                        .Put("removed", total)
                        .PutRaw("affected", SerializeAffected(affected))
                        .ToString());
                }
                finally
                {
                    PrefabOps.SafeUnloadPrefabContents(prefabRoot);
                }
            }

            return CommandResult.Ok(SimpleJson.Object()
                .Put("target", "folder")
                .Put("path", folder)
                .Put("scanned", guids.Length)
                .Put("cleanedPrefabs", cleanedPrefabs)
                .Put("totalRemoved", grandTotal)
                .Put("dryRun", dryRun)
                .PutRaw("prefabs", prefabSummaries.ToString())
                .ToString());
        }

        /// <summary>Walk a GameObject tree and remove (or count) missing-script components.</summary>
        static int WalkAndScrub(GameObject go, bool recursive, bool dryRun, List<ScrubEntry> affected)
        {
            int count = dryRun
                ? GameObjectUtility.GetMonoBehavioursWithMissingScriptCount(go)
                : GameObjectUtility.RemoveMonoBehavioursWithMissingScript(go);

            int total = count;
            if (count > 0)
                affected.Add(new ScrubEntry { Path = PropertyOps.GetScenePath(go), Count = count });

            if (recursive)
            {
                int childCount = go.transform.childCount;
                for (int i = 0; i < childCount; i++)
                    total += WalkAndScrub(go.transform.GetChild(i).gameObject, true, dryRun, affected);
            }

            return total;
        }

        static string SerializeAffected(List<ScrubEntry> affected)
        {
            var arr = SimpleJson.Array();
            foreach (var a in affected)
            {
                arr.AddRaw(SimpleJson.Object()
                    .Put("path", a.Path)
                    .Put("removed", a.Count)
                    .ToString());
            }
            return arr.ToString();
        }

        struct ScrubEntry
        {
            public string Path;
            public int Count;
        }

        /// <summary>Resolve a type by name across all loaded assemblies.</summary>
        public static Type ResolveType(string typeName)
        {
            if (string.IsNullOrEmpty(typeName)) return null;

            Type t = Type.GetType(typeName);
            if (t != null) return t;

            foreach (var asm in AppDomain.CurrentDomain.GetAssemblies())
            {
                try
                {
                    t = asm.GetTypes().FirstOrDefault(
                        type => type.FullName == typeName || type.Name == typeName);
                    if (t != null) return t;
                }
                catch (ReflectionTypeLoadException) { }
            }

            return null;
        }
    }
}
