using System;
using System.Collections.Generic;
using System.IO;
using UnityEditor;
using UnityEditor.Animations;
using UnityEngine;

namespace Dreamer.AgentBridge.Animation
{
    /// <summary>
    /// AnimatorOverrideController authoring. Override controllers reuse a
    /// base AnimatorController's state machine but swap out individual
    /// AnimationClips — useful for variant characters (different races /
    /// weapons / species) sharing one logical state graph.
    /// </summary>
    public static class AnimatorOverrideOps
    {
        // ── create-animator-override-controller ───────────────────────────

        public static CommandResult CreateAnimatorOverrideController(Dictionary<string, object> args)
        {
            string name = SimpleJson.GetString(args, "name");
            if (string.IsNullOrEmpty(name)) return CommandResult.Fail("'name' is required.");

            string folder = SimpleJson.GetString(args, "path", "Assets/Animations");
            if (!AssetDatabase.IsValidFolder(folder))
            {
                Directory.CreateDirectory(Path.GetFullPath(folder));
                AssetDatabase.Refresh();
            }

            string basePath = SimpleJson.GetString(args, "base");
            if (string.IsNullOrEmpty(basePath)) return CommandResult.Fail("'base' (path to a base AnimatorController) is required.");
            var baseCtrl = AssetDatabase.LoadAssetAtPath<AnimatorController>(basePath);
            if (baseCtrl == null) return CommandResult.Fail($"Base AnimatorController not found at '{basePath}'.");

            string assetPath = $"{folder}/{name}.overrideController";
            if (File.Exists(Path.GetFullPath(assetPath)))
                return CommandResult.Fail($"AnimatorOverrideController already exists at '{assetPath}'.");

            var ovr = new AnimatorOverrideController(baseCtrl);
            ovr.name = name;
            AssetDatabase.CreateAsset(ovr, assetPath);
            AssetDatabase.SaveAssets();

            return CommandResult.Ok(SimpleJson.Object()
                .Put("created", true)
                .Put("assetPath", assetPath)
                .Put("name", name)
                .Put("base", basePath)
                .Put("clipCount", ovr.animationClips != null ? ovr.animationClips.Length : 0)
                .ToString());
        }

        // ── set-animator-override-clip ────────────────────────────────────
        // Set one or more clip overrides. Either pass --base-clip + --override-clip
        // for a single override, or --overrides JSON [{baseClip, overrideClip}, ...]
        // for batch.

        public static CommandResult SetAnimatorOverrideClip(Dictionary<string, object> args)
        {
            string assetPath = AssetOps.ResolveAssetPath(args);
            if (string.IsNullOrEmpty(assetPath)) return CommandResult.Fail("'assetPath' or 'guid' is required.");
            var ovr = AssetDatabase.LoadAssetAtPath<AnimatorOverrideController>(assetPath);
            if (ovr == null) return CommandResult.Fail($"AnimatorOverrideController not found at '{assetPath}'.");

            // Build a name → original-clip lookup once.
            var pairs = new List<KeyValuePair<AnimationClip, AnimationClip>>(ovr.overridesCount);
            ovr.GetOverrides(pairs);

            int applied = 0;
            var updates = new List<(string baseName, string overrideName)>();

            // Single-override form.
            string singleBase = SimpleJson.GetString(args, "baseClip");
            string singleOverride = SimpleJson.GetString(args, "overrideClip");
            if (!string.IsNullOrEmpty(singleBase))
            {
                updates.Add((singleBase, singleOverride));
            }

            // Batch form.
            object multiRaw = SimpleJson.GetValue(args, "overrides");
            if (multiRaw is List<object> multiList)
            {
                foreach (var item in multiList)
                {
                    if (!(item is Dictionary<string, object> e))
                        return CommandResult.Fail("Each entry in 'overrides' must be {baseClip, overrideClip}.");
                    updates.Add((SimpleJson.GetString(e, "baseClip"), SimpleJson.GetString(e, "overrideClip")));
                }
            }

            if (updates.Count == 0)
                return CommandResult.Fail("Provide --base-clip + --override-clip, or --overrides JSON for batch.");

            for (int i = 0; i < pairs.Count; i++)
            {
                var orig = pairs[i].Key;
                if (orig == null) continue;
                foreach (var u in updates)
                {
                    // baseClip can be a name (no path) or an asset path. Match
                    // either by clip.name or by AssetDatabase.GetAssetPath.
                    bool nameMatch = orig.name == u.baseName;
                    bool pathMatch = !string.IsNullOrEmpty(u.baseName) && AssetDatabase.GetAssetPath(orig) == u.baseName;
                    if (!nameMatch && !pathMatch) continue;

                    AnimationClip newClip = null;
                    if (!string.IsNullOrEmpty(u.overrideName))
                    {
                        newClip = AssetDatabase.LoadAssetAtPath<AnimationClip>(u.overrideName);
                        if (newClip == null)
                            return CommandResult.Fail($"Override clip not found at '{u.overrideName}'.");
                    }
                    pairs[i] = new KeyValuePair<AnimationClip, AnimationClip>(orig, newClip);
                    applied++;
                    break;
                }
            }

            ovr.ApplyOverrides(pairs);
            EditorUtility.SetDirty(ovr);
            AssetDatabase.SaveAssets();

            return CommandResult.Ok(SimpleJson.Object()
                .Put("set", true)
                .Put("assetPath", assetPath)
                .Put("appliedCount", applied)
                .Put("requestedCount", updates.Count)
                .ToString());
        }

        // ── inspect-animator-override-controller ──────────────────────────

        public static CommandResult InspectAnimatorOverrideController(Dictionary<string, object> args)
        {
            string assetPath = AssetOps.ResolveAssetPath(args);
            if (string.IsNullOrEmpty(assetPath)) return CommandResult.Fail("'assetPath' or 'guid' is required.");
            var ovr = AssetDatabase.LoadAssetAtPath<AnimatorOverrideController>(assetPath);
            if (ovr == null) return CommandResult.Fail($"AnimatorOverrideController not found at '{assetPath}'.");

            var pairs = new List<KeyValuePair<AnimationClip, AnimationClip>>(ovr.overridesCount);
            ovr.GetOverrides(pairs);

            int withOverride = 0;
            var entries = SimpleJson.Array();
            foreach (var kv in pairs)
            {
                bool hasOverride = kv.Value != null;
                if (hasOverride) withOverride++;
                entries.AddRaw(SimpleJson.Object()
                    .Put("baseClip", kv.Key != null ? kv.Key.name : null)
                    .Put("baseClipPath", kv.Key != null ? AssetDatabase.GetAssetPath(kv.Key) : null)
                    .Put("overrideClip", kv.Value != null ? kv.Value.name : null)
                    .Put("overrideClipPath", kv.Value != null ? AssetDatabase.GetAssetPath(kv.Value) : null)
                    .Put("hasOverride", hasOverride)
                    .ToString());
            }

            return CommandResult.Ok(SimpleJson.Object()
                .Put("assetPath", assetPath)
                .Put("name", ovr.name)
                .Put("base", ovr.runtimeAnimatorController != null ? AssetDatabase.GetAssetPath(ovr.runtimeAnimatorController) : null)
                .Put("clipCount", pairs.Count)
                .Put("overriddenCount", withOverride)
                .PutRaw("overrides", entries.ToString())
                .ToString());
        }
    }
}
