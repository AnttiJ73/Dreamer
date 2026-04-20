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
        /// Inspect a specific asset or scene object in detail.
        /// Args: { assetPath?: "path", guid?: "guid", sceneObjectPath?: "MyObject/Child" }
        /// </summary>
        public static CommandResult InspectAsset(Dictionary<string, object> args)
        {
            // Scene object inspection
            string sceneObjectPath = SimpleJson.GetString(args, "sceneObjectPath");
            if (!string.IsNullOrEmpty(sceneObjectPath))
                return InspectSceneObject(sceneObjectPath);

            string assetPath = ResolveAssetPath(args);
            if (assetPath == null)
                return CommandResult.Fail("Target not found. Provide 'assetPath', 'guid', or 'sceneObjectPath'.");

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
        ///
        /// Auto-heal: if the caller passes a `changedFiles` array (forward-slash
        /// "Assets/..." paths), every .cs file that Unity imports as something
        /// other than MonoScript (i.e. got classified as the default/unknown
        /// importer because of an ill-timed write outside the Editor) is
        /// force-reimported. This fixes the common "script exists on disk but
        /// doesn't appear in Assembly-CSharp and can't be assigned to prefabs"
        /// bug caused by unfocused-Editor imports.
        ///
        /// Result JSON:
        ///   { refreshed: true, checked: N, reimported: [...], misclassified: [...] }
        /// where `misclassified` lists files that are STILL not MonoScript after
        /// the force-reimport — those need human intervention (bad namespace,
        /// syntax preventing initial parse, etc.).
        /// </summary>
        public static CommandResult RefreshAssets(Dictionary<string, object> args)
        {
            AssetDatabase.Refresh(ImportAssetOptions.Default);

            // Auto-heal phase. Only runs when the daemon-side watcher gave us a
            // concrete list of changed files; a bare refresh_assets call with
            // no arg list skips this entirely (fast path, unchanged behavior).
            var reimported = new List<string>();
            var misclassified = new List<string>();
            int checkedCount = 0;

            if (args.TryGetValue("changedFiles", out object cfObj) && cfObj is List<object> cfList)
            {
                foreach (var item in cfList)
                {
                    string p = item as string;
                    if (string.IsNullOrEmpty(p)) continue;
                    if (!p.EndsWith(".cs", StringComparison.OrdinalIgnoreCase)) continue;
                    if (!System.IO.File.Exists(System.IO.Path.GetFullPath(p))) continue;

                    checkedCount++;
                    var healResult = HealScriptClassification(p);
                    if (healResult == HealOutcome.Reimported) reimported.Add(p);
                    else if (healResult == HealOutcome.StillMisclassified) misclassified.Add(p);
                }
            }

            var resultJson = SimpleJson.Object()
                .Put("refreshed", true)
                .Put("checked", checkedCount)
                .Put("reimportedCount", reimported.Count)
                .Put("misclassifiedCount", misclassified.Count)
                .Put("reimported", reimported.ToArray())
                .Put("misclassified", misclassified.ToArray());
            if (misclassified.Count > 0)
            {
                resultJson.Put("hint",
                    "Some .cs files are still not classified as MonoScript after force-reimport. " +
                    "Common causes: syntax error preventing initial parse, namespace/class-name mismatch with filename, " +
                    "or Unity still treating the file as an unknown asset type. Run `./bin/dreamer reimport-script --path <file>` " +
                    "to try a stronger repair, or inspect the file and fix any syntax issues.");
            }
            return CommandResult.Ok(resultJson.ToString());
        }

        /// <summary>
        /// Explicit rescue command. Force-reimports all .cs files under the given
        /// path (single file or folder). Unlike RefreshAssets, this runs
        /// force-reimport on every .cs regardless of current classification —
        /// useful when the watcher missed the original write and the file is
        /// stuck as unknown.
        ///
        /// Args: { path: "Assets/Foo.cs" | "Assets/Scripts", recursive?: true }
        /// </summary>
        public static CommandResult ReimportScripts(Dictionary<string, object> args)
        {
            string target = SimpleJson.GetString(args, "path");
            if (string.IsNullOrEmpty(target))
                return CommandResult.Fail("'path' is required (a .cs file or a folder containing .cs files).");

            bool recursive = !args.ContainsKey("recursive") || SimpleJson.GetBool(args, "recursive", true);

            // Normalize to forward slashes so we can compare with AssetDatabase paths.
            target = target.Replace('\\', '/').TrimEnd('/');

            var reimported = new List<string>();
            var healed = new List<string>();
            var misclassified = new List<string>();

            string full = System.IO.Path.GetFullPath(target);
            if (System.IO.File.Exists(full))
            {
                if (!target.EndsWith(".cs", StringComparison.OrdinalIgnoreCase))
                    return CommandResult.Fail($"Path '{target}' is a file but not a .cs — reimport-script only handles scripts.");
                ForceReimport(target, reimported, healed, misclassified);
            }
            else if (System.IO.Directory.Exists(full))
            {
                var opt = recursive ? SearchOption.AllDirectories : SearchOption.TopDirectoryOnly;
                var files = System.IO.Directory.GetFiles(full, "*.cs", opt);
                foreach (var f in files)
                {
                    // Convert absolute path back to AssetDatabase form. Unity treats
                    // both "Assets/..." (project assets) and "Packages/..." (embedded /
                    // resolved packages) as valid asset roots. Earlier versions of this
                    // loop only looked for /Assets/, so any .cs under Packages/ was
                    // silently skipped — which made the rescue command useless for
                    // editing add-on package code (the exact case this is most needed for).
                    string rel = f.Replace('\\', '/');
                    string assetPath = ToAssetDatabasePath(rel);
                    if (assetPath == null) continue;
                    ForceReimport(assetPath, reimported, healed, misclassified);
                }
            }
            else
            {
                return CommandResult.Fail($"Path not found: {target}");
            }

            // Kick a compile — force-reimport alone doesn't always trigger one if Unity's
            // compilation pipeline thinks nothing relevant changed.
            UnityEditor.Compilation.CompilationPipeline.RequestScriptCompilation();

            return CommandResult.Ok(SimpleJson.Object()
                .Put("path", target)
                .Put("recursive", recursive)
                .Put("reimportedCount", reimported.Count)
                .Put("healedCount", healed.Count)
                .Put("misclassifiedCount", misclassified.Count)
                .Put("reimported", reimported.ToArray())
                .Put("healed", healed.ToArray())
                .Put("misclassified", misclassified.ToArray())
                .ToString());
        }

        /// <summary>
        /// Convert a forward-slash absolute or relative path to an AssetDatabase
        /// path. Unity accepts both "Assets/..." and "Packages/..." as roots —
        /// returns the substring starting at whichever it finds, or null when
        /// the path doesn't sit inside either (out-of-project file).
        /// </summary>
        static string ToAssetDatabasePath(string forwardSlashPath)
        {
            if (string.IsNullOrEmpty(forwardSlashPath)) return null;

            // Already a relative AssetDatabase path?
            if (forwardSlashPath.StartsWith("Assets/", StringComparison.OrdinalIgnoreCase)
                || forwardSlashPath.StartsWith("Packages/", StringComparison.OrdinalIgnoreCase))
                return forwardSlashPath;

            // Absolute path — look for /Assets/ or /Packages/ inside.
            int aIdx = forwardSlashPath.IndexOf("/Assets/", StringComparison.OrdinalIgnoreCase);
            int pIdx = forwardSlashPath.IndexOf("/Packages/", StringComparison.OrdinalIgnoreCase);

            // Pick the rightmost match (handles unusual layouts where a project lives under
            // another path containing "Assets" or "Packages" — the project's own root wins).
            int idx = Math.Max(aIdx, pIdx);
            if (idx < 0) return null;

            return forwardSlashPath.Substring(idx + 1);
        }

        enum HealOutcome { AlreadyMonoScript, Reimported, StillMisclassified }

        /// <summary>
        /// Check whether <paramref name="assetPath"/> is classified as MonoScript.
        /// If not, force-reimport and check again. Returns which outcome landed.
        /// </summary>
        static HealOutcome HealScriptClassification(string assetPath)
        {
            var typeBefore = AssetDatabase.GetMainAssetTypeAtPath(assetPath);
            if (typeBefore == typeof(MonoScript)) return HealOutcome.AlreadyMonoScript;

            // Force a full re-import. ForceUpdate says "pretend the hash changed";
            // ForceSynchronousImport says "don't defer, do it now on this thread."
            AssetDatabase.ImportAsset(assetPath,
                ImportAssetOptions.ForceSynchronousImport | ImportAssetOptions.ForceUpdate);

            var typeAfter = AssetDatabase.GetMainAssetTypeAtPath(assetPath);
            return typeAfter == typeof(MonoScript)
                ? HealOutcome.Reimported
                : HealOutcome.StillMisclassified;
        }

        /// <summary>
        /// Force-reimport a .cs file unconditionally (for the rescue command path).
        /// Reports which bucket it lands in.
        /// </summary>
        static void ForceReimport(string assetPath, List<string> reimported, List<string> healed, List<string> misclassified)
        {
            var typeBefore = AssetDatabase.GetMainAssetTypeAtPath(assetPath);
            bool wasMonoScript = typeBefore == typeof(MonoScript);

            AssetDatabase.ImportAsset(assetPath,
                ImportAssetOptions.ForceSynchronousImport | ImportAssetOptions.ForceUpdate);

            var typeAfter = AssetDatabase.GetMainAssetTypeAtPath(assetPath);
            reimported.Add(assetPath);
            if (!wasMonoScript && typeAfter == typeof(MonoScript)) healed.Add(assetPath);
            else if (typeAfter != typeof(MonoScript)) misclassified.Add(assetPath);
        }

        /// <summary>
        /// Create a ScriptableObject asset instance.
        /// Args: { typeName: "Game.MyDataSO", name: "EnemyData", path?: "Assets/Data" }
        /// </summary>
        public static CommandResult CreateScriptableObject(Dictionary<string, object> args)
        {
            string typeName = SimpleJson.GetString(args, "typeName");
            if (string.IsNullOrEmpty(typeName))
                return CommandResult.Fail("'typeName' is required.");

            string name = SimpleJson.GetString(args, "name");
            if (string.IsNullOrEmpty(name))
                return CommandResult.Fail("'name' is required.");

            string folder = SimpleJson.GetString(args, "path", "Assets/Data");

            Type soType = ComponentOps.ResolveType(typeName);
            if (soType == null)
                return CommandResult.Fail($"Type not found: {typeName}");

            if (!typeof(ScriptableObject).IsAssignableFrom(soType))
                return CommandResult.Fail($"Type '{typeName}' does not derive from ScriptableObject.");

            // Ensure directory exists
            string fullDir = Path.GetFullPath(folder);
            if (!Directory.Exists(fullDir))
            {
                Directory.CreateDirectory(fullDir);
                AssetDatabase.Refresh();
            }

            string assetPath = $"{folder}/{name}.asset";

            var instance = ScriptableObject.CreateInstance(soType);
            if (instance == null)
                return CommandResult.Fail($"Failed to create instance of '{typeName}'.");

            AssetDatabase.CreateAsset(instance, assetPath);
            AssetDatabase.SaveAssets();

            string guid = AssetDatabase.AssetPathToGUID(assetPath);

            var json = SimpleJson.Object()
                .Put("path", assetPath)
                .Put("guid", guid)
                .Put("typeName", soType.FullName)
                .Put("name", name)
                .Put("created", true)
                .ToString();

            return CommandResult.Ok(json);
        }

        // ── Scene object inspection ──

        static CommandResult InspectSceneObject(string objectPath)
        {
            var go = PropertyOps.FindSceneObject(objectPath, out string findError);
            if (go == null)
                return CommandResult.Fail(findError ?? $"Scene object not found at path: {objectPath}");

            var result = SimpleJson.Object()
                .Put("name", go.name)
                .Put("path", GetHierarchyPath(go))
                .Put("instanceId", go.GetInstanceID())
                .Put("active", go.activeSelf)
                .Put("tag", go.tag)
                .Put("layer", go.layer)
                .Put("isStatic", go.isStatic);

            // Is it a prefab instance?
            var prefabAsset = PrefabUtility.GetCorrespondingObjectFromSource(go);
            if (prefabAsset != null)
            {
                string prefabPath = AssetDatabase.GetAssetPath(prefabAsset);
                result.Put("prefabSource", prefabPath);
            }

            // Components with serialized fields
            var comps = SimpleJson.Array();
            foreach (var comp in go.GetComponents<Component>())
            {
                if (comp == null) continue;
                var compObj = SimpleJson.Object()
                    .Put("type", comp.GetType().FullName)
                    .Put("name", comp.GetType().Name);

                // List serialized fields
                var fields = SimpleJson.Array();
                var so = new SerializedObject(comp);
                var prop = so.GetIterator();
                if (prop.NextVisible(true))
                {
                    do
                    {
                        // Skip internal Unity fields
                        if (prop.name == "m_Script" || prop.name == "m_ObjectHideFlags") continue;
                        var fieldObj = SimpleJson.Object()
                            .Put("name", prop.name)
                            .Put("type", prop.propertyType.ToString());
                        // Show value for simple types
                        switch (prop.propertyType)
                        {
                            case SerializedPropertyType.Integer: fieldObj.Put("value", prop.intValue); break;
                            case SerializedPropertyType.Float: fieldObj.Put("value", prop.floatValue); break;
                            case SerializedPropertyType.Boolean: fieldObj.Put("value", prop.boolValue); break;
                            case SerializedPropertyType.String: fieldObj.Put("value", prop.stringValue); break;
                            case SerializedPropertyType.Enum: fieldObj.Put("value", prop.enumNames[prop.enumValueIndex]); break;
                            case SerializedPropertyType.ObjectReference:
                                fieldObj.Put("value", prop.objectReferenceValue != null ? prop.objectReferenceValue.name : "null");
                                break;
                        }
                        fields.AddRaw(fieldObj.ToString());
                    } while (prop.NextVisible(false));
                }
                compObj.PutRaw("fields", fields.ToString());
                comps.AddRaw(compObj.ToString());
            }
            result.PutRaw("components", comps.ToString());

            // Children
            var children = SimpleJson.Array();
            for (int i = 0; i < go.transform.childCount; i++)
            {
                var child = go.transform.GetChild(i).gameObject;
                var childComps = SimpleJson.Array();
                foreach (var c in child.GetComponents<Component>())
                {
                    if (c == null) continue;
                    childComps.AddRaw(SimpleJson.Object()
                        .Put("type", c.GetType().Name)
                        .ToString());
                }
                children.AddRaw(SimpleJson.Object()
                    .Put("name", child.name)
                    .Put("active", child.activeSelf)
                    .Put("childCount", child.transform.childCount)
                    .PutRaw("components", childComps.ToString())
                    .ToString());
            }
            result.PutRaw("children", children.ToString());

            return CommandResult.Ok(result.ToString());
        }

        static string GetHierarchyPath(GameObject go)
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
