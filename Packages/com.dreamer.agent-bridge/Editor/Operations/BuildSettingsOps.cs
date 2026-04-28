using System;
using System.Collections.Generic;
using UnityEditor;
using UnityEngine;

namespace Dreamer.AgentBridge
{
    /// <summary>EditorBuildSettings authoring — primarily the build-scenes list. .scenes is the canonical setter; persists immediately.</summary>
    public static class BuildSettingsOps
    {
        public static CommandResult InspectBuildScenes(Dictionary<string, object> args)
        {
            var scenes = EditorBuildSettings.scenes ?? new EditorBuildSettingsScene[0];
            var arr = SimpleJson.Array();
            for (int i = 0; i < scenes.Length; i++)
            {
                var s = scenes[i];
                arr.AddRaw(SimpleJson.Object()
                    .Put("index", i)
                    .Put("path", s.path ?? "")
                    .Put("enabled", s.enabled)
                    .Put("guid", s.guid.ToString())
                    .ToString());
            }
            return CommandResult.Ok(SimpleJson.Object()
                .Put("count", scenes.Length)
                .PutRaw("scenes", arr.ToString())
                .ToString());
        }

        public static CommandResult SetBuildScenes(Dictionary<string, object> args)
        {
            if (!args.TryGetValue("scenes", out object scenesObj) || !(scenesObj is List<object> list))
                return CommandResult.Fail("'scenes' is required (JSON array; each item is either a string path or {path, enabled?}).");

            var built = new List<EditorBuildSettingsScene>();
            for (int i = 0; i < list.Count; i++)
            {
                string path;
                bool enabled = true;
                if (list[i] is string s)
                {
                    path = s;
                }
                else if (list[i] is Dictionary<string, object> d)
                {
                    path = SimpleJson.GetString(d, "path");
                    enabled = SimpleJson.GetBool(d, "enabled", true);
                }
                else
                {
                    return CommandResult.Fail($"scenes[{i}]: expected a string path or object {{path, enabled?}}.");
                }

                if (string.IsNullOrEmpty(path))
                    return CommandResult.Fail($"scenes[{i}]: 'path' is empty.");
                if (!System.IO.File.Exists(path))
                    return CommandResult.Fail($"scenes[{i}]: scene file not found at '{path}'.");

                built.Add(new EditorBuildSettingsScene(path, enabled));
            }

            EditorBuildSettings.scenes = built.ToArray();
            AssetDatabase.SaveAssets();

            return CommandResult.Ok(SimpleJson.Object()
                .Put("count", built.Count)
                .Put("set", true)
                .ToString());
        }

        public static CommandResult AddBuildScene(Dictionary<string, object> args)
        {
            string path = SimpleJson.GetString(args, "scene");
            if (string.IsNullOrEmpty(path))
                return CommandResult.Fail("'scene' is required.");
            bool enabled = SimpleJson.GetBool(args, "enabled", true);

            if (!System.IO.File.Exists(path))
                return CommandResult.Fail($"Scene file not found at '{path}'.");

            var current = new List<EditorBuildSettingsScene>(EditorBuildSettings.scenes ?? new EditorBuildSettingsScene[0]);
            for (int i = 0; i < current.Count; i++)
            {
                if (string.Equals(current[i].path, path, StringComparison.OrdinalIgnoreCase))
                {
                    bool changed = current[i].enabled != enabled;
                    current[i] = new EditorBuildSettingsScene(path, enabled);
                    if (changed)
                    {
                        EditorBuildSettings.scenes = current.ToArray();
                        AssetDatabase.SaveAssets();
                    }
                    return CommandResult.Ok(SimpleJson.Object()
                        .Put("scene", path)
                        .Put("added", false)
                        .Put("enabledUpdated", changed)
                        .Put("index", i)
                        .Put("note", "Scene already in list — enabled flag updated if it changed.")
                        .ToString());
                }
            }

            current.Add(new EditorBuildSettingsScene(path, enabled));
            EditorBuildSettings.scenes = current.ToArray();
            AssetDatabase.SaveAssets();

            return CommandResult.Ok(SimpleJson.Object()
                .Put("scene", path)
                .Put("added", true)
                .Put("index", current.Count - 1)
                .Put("enabled", enabled)
                .ToString());
        }

        public static CommandResult RemoveBuildScene(Dictionary<string, object> args)
        {
            string path = SimpleJson.GetString(args, "scene");
            if (string.IsNullOrEmpty(path))
                return CommandResult.Fail("'scene' is required.");

            var current = new List<EditorBuildSettingsScene>(EditorBuildSettings.scenes ?? new EditorBuildSettingsScene[0]);
            for (int i = 0; i < current.Count; i++)
            {
                if (string.Equals(current[i].path, path, StringComparison.OrdinalIgnoreCase))
                {
                    current.RemoveAt(i);
                    EditorBuildSettings.scenes = current.ToArray();
                    AssetDatabase.SaveAssets();
                    return CommandResult.Ok(SimpleJson.Object()
                        .Put("scene", path)
                        .Put("removed", true)
                        .Put("removedAtIndex", i)
                        .ToString());
                }
            }

            return CommandResult.Ok(SimpleJson.Object()
                .Put("scene", path)
                .Put("removed", false)
                .Put("note", "Scene not in build list — no change.")
                .ToString());
        }
    }
}
