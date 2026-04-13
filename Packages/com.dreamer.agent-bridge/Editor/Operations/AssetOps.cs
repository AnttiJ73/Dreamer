using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEngine;

namespace Dreamer.AgentBridge
{
    public static class AssetOps
    {
        const int MaxResults = 100;

        /// <summary>
        /// Find assets by type/name/path.
        /// Args: { type?: "prefab"|"script"|"scene"|"material"|"texture"|"all", name?: "pattern", path?: "Assets/folder" }
        /// </summary>
        public static CommandResult FindAssets(Dictionary<string, object> args)
        {
            string typeFilter = SimpleJson.GetString(args, "type", "all");
            string nameFilter = SimpleJson.GetString(args, "name");
            string pathFilter = SimpleJson.GetString(args, "path");

            // Build AssetDatabase search filter
            string filter = BuildFilter(typeFilter, nameFilter);

            string[] searchFolders = null;
            if (!string.IsNullOrEmpty(pathFilter))
            {
                if (!AssetDatabase.IsValidFolder(pathFilter))
                    return CommandResult.Fail($"Folder not found: {pathFilter}");
                searchFolders = new[] { pathFilter };
            }

            string[] guids;
            if (searchFolders != null)
                guids = AssetDatabase.FindAssets(filter, searchFolders);
            else
                guids = AssetDatabase.FindAssets(filter);

            var results = SimpleJson.Array();
            int count = 0;

            foreach (string guid in guids)
            {
                if (count >= MaxResults) break;

                string assetPath = AssetDatabase.GUIDToAssetPath(guid);
                if (string.IsNullOrEmpty(assetPath)) continue;

                // Additional name filtering (FindAssets only does prefix matching)
                if (!string.IsNullOrEmpty(nameFilter))
                {
                    string assetName = Path.GetFileNameWithoutExtension(assetPath);
                    if (!assetName.Contains(nameFilter, StringComparison.OrdinalIgnoreCase)
                        && !assetPath.Contains(nameFilter, StringComparison.OrdinalIgnoreCase))
                        continue;
                }

                Type assetType = AssetDatabase.GetMainAssetTypeAtPath(assetPath);
                string typeName = assetType != null ? assetType.Name : "Unknown";

                string lastModified = "";
                string fullPath = Path.GetFullPath(assetPath);
                if (File.Exists(fullPath))
                    lastModified = File.GetLastWriteTimeUtc(fullPath).ToString("o");

                results.AddRaw(SimpleJson.Object()
                    .Put("name", Path.GetFileNameWithoutExtension(assetPath))
                    .Put("path", assetPath)
                    .Put("guid", guid)
                    .Put("type", typeName)
                    .Put("lastModified", lastModified)
                    .ToString());

                count++;
            }

            var json = SimpleJson.Object()
                .PutRaw("assets", results.ToString())
                .Put("count", count)
                .Put("totalFound", guids.Length)
                .ToString();

            return CommandResult.Ok(json);
        }

        /// <summary>
        /// Inspect a specific asset in detail.
        /// Args: { assetPath?: "path", guid?: "guid" }
        /// </summary>
        public static CommandResult InspectAsset(Dictionary<string, object> args)
        {
            string assetPath = ResolveAssetPath(args);
            if (assetPath == null)
                return CommandResult.Fail("Asset not found. Provide a valid 'assetPath' or 'guid'.");

            Type assetType = AssetDatabase.GetMainAssetTypeAtPath(assetPath);
            if (assetType == null)
                return CommandResult.Fail($"Cannot determine type of asset at: {assetPath}");

            string guid = AssetDatabase.AssetPathToGUID(assetPath);
            string typeName = assetType.Name;

            var result = SimpleJson.Object()
                .Put("path", assetPath)
                .Put("guid", guid)
                .Put("type", typeName)
                .Put("name", Path.GetFileNameWithoutExtension(assetPath));

            // Type-specific details
            if (assetType == typeof(GameObject) || assetPath.EndsWith(".prefab", StringComparison.OrdinalIgnoreCase))
            {
                InspectPrefab(assetPath, result);
            }
            else if (assetType == typeof(MonoScript) || assetPath.EndsWith(".cs", StringComparison.OrdinalIgnoreCase))
            {
                InspectScript(assetPath, result);
            }
            else if (assetType == typeof(SceneAsset) || assetPath.EndsWith(".unity", StringComparison.OrdinalIgnoreCase))
            {
                InspectScene(assetPath, result);
            }
            else
            {
                // Generic asset info
                string fullPath = Path.GetFullPath(assetPath);
                if (File.Exists(fullPath))
                {
                    var info = new FileInfo(fullPath);
                    result.Put("sizeBytes", info.Length);
                    result.Put("lastModified", info.LastWriteTimeUtc.ToString("o"));
                }
            }

            return CommandResult.Ok(result.ToString());
        }

        /// <summary>
        /// Save all assets and refresh the database.
        /// </summary>
        public static CommandResult SaveAssets(Dictionary<string, object> args)
        {
            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();
            return CommandResult.Ok(SimpleJson.Object().Put("saved", true).ToString());
        }

        /// <summary>
        /// Force Unity to scan the disk for changed/new/deleted assets.
        /// This is essential when files are written externally (by an agent, CLI, etc.)
        /// because Unity on Windows does not reliably detect changes without focus.
        /// </summary>
        public static CommandResult RefreshAssets(Dictionary<string, object> args)
        {
            AssetDatabase.Refresh(ImportAssetOptions.Default);
            return CommandResult.Ok(SimpleJson.Object().Put("refreshed", true).ToString());
        }

        // ── Helpers ──

        public static string ResolveAssetPath(Dictionary<string, object> args)
        {
            string path = SimpleJson.GetString(args, "assetPath");
            if (!string.IsNullOrEmpty(path))
            {
                if (File.Exists(path) || AssetDatabase.GetMainAssetTypeAtPath(path) != null)
                    return path;
            }

            string guid = SimpleJson.GetString(args, "guid");
            if (!string.IsNullOrEmpty(guid))
            {
                path = AssetDatabase.GUIDToAssetPath(guid);
                if (!string.IsNullOrEmpty(path))
                    return path;
            }

            return null;
        }

        static string BuildFilter(string typeFilter, string nameFilter)
        {
            var parts = new List<string>();

            if (!string.IsNullOrEmpty(nameFilter))
                parts.Add(nameFilter);

            if (!string.IsNullOrEmpty(typeFilter) && typeFilter != "all")
            {
                switch (typeFilter.ToLowerInvariant())
                {
                    case "prefab":    parts.Add("t:Prefab");           break;
                    case "script":    parts.Add("t:Script");           break;
                    case "scene":     parts.Add("t:Scene");            break;
                    case "material":  parts.Add("t:Material");         break;
                    case "texture":   parts.Add("t:Texture");          break;
                    default:          parts.Add($"t:{typeFilter}");    break;
                }
            }

            return string.Join(" ", parts);
        }

        static void InspectPrefab(string assetPath, JsonBuilder result)
        {
            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(assetPath);
            if (prefab == null) return;

            // Root components
            var rootComps = SimpleJson.Array();
            foreach (var comp in prefab.GetComponents<Component>())
            {
                if (comp == null) continue;
                rootComps.AddRaw(SimpleJson.Object()
                    .Put("type", comp.GetType().FullName)
                    .Put("name", comp.GetType().Name)
                    .ToString());
            }
            result.PutRaw("components", rootComps.ToString());

            // Children (1 level)
            var children = SimpleJson.Array();
            for (int i = 0; i < prefab.transform.childCount; i++)
            {
                var child = prefab.transform.GetChild(i);
                var childComps = SimpleJson.Array();
                foreach (var comp in child.GetComponents<Component>())
                {
                    if (comp == null) continue;
                    childComps.Add(comp.GetType().Name);
                }
                children.AddRaw(SimpleJson.Object()
                    .Put("name", child.name)
                    .PutRaw("components", childComps.ToString())
                    .Put("childCount", child.childCount)
                    .ToString());
            }
            result.PutRaw("children", children.ToString());
        }

        static void InspectScript(string assetPath, JsonBuilder result)
        {
            var monoScript = AssetDatabase.LoadAssetAtPath<MonoScript>(assetPath);
            if (monoScript == null) return;

            var scriptClass = monoScript.GetClass();
            if (scriptClass != null)
            {
                result.Put("className", scriptClass.Name);
                result.Put("namespace", scriptClass.Namespace ?? "");
                result.Put("baseClass", scriptClass.BaseType?.Name ?? "");
                result.Put("isAbstract", scriptClass.IsAbstract);

                var fields = SimpleJson.Array();
                foreach (var field in scriptClass.GetFields(
                    System.Reflection.BindingFlags.Public |
                    System.Reflection.BindingFlags.Instance |
                    System.Reflection.BindingFlags.DeclaredOnly))
                {
                    fields.AddRaw(SimpleJson.Object()
                        .Put("name", field.Name)
                        .Put("type", field.FieldType.Name)
                        .ToString());
                }
                result.PutRaw("publicFields", fields.ToString());
            }
            else
            {
                result.Put("className", Path.GetFileNameWithoutExtension(assetPath));
                result.Put("note", "Class not loaded (may not be a MonoBehaviour/ScriptableObject)");
            }
        }

        static void InspectScene(string assetPath, JsonBuilder result)
        {
            // We can only list scene info from the asset database, not load it
            result.Put("isScene", true);

            string fullPath = Path.GetFullPath(assetPath);
            if (File.Exists(fullPath))
            {
                var info = new FileInfo(fullPath);
                result.Put("sizeBytes", info.Length);
                result.Put("lastModified", info.LastWriteTimeUtc.ToString("o"));
            }

            // Check if this scene is currently loaded
            var activeScene = UnityEngine.SceneManagement.SceneManager.GetActiveScene();
            result.Put("isActiveScene", activeScene.path == assetPath);
        }
    }
}
