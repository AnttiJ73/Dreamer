using System;
using System.Collections.Generic;
using System.IO;
using UnityEditor;
using UnityEngine;

namespace Dreamer.AgentBridge.Animation
{
    /// <summary>AvatarMask asset authoring — selects bones / humanoid body parts an animator layer applies to.</summary>
    public static class AvatarMaskOps
    {
        public static CommandResult CreateAvatarMask(Dictionary<string, object> args)
        {
            string name = SimpleJson.GetString(args, "name");
            if (string.IsNullOrEmpty(name)) return CommandResult.Fail("'name' is required.");

            string folder = SimpleJson.GetString(args, "path", "Assets/Animations");
            if (!AssetDatabase.IsValidFolder(folder))
            {
                Directory.CreateDirectory(Path.GetFullPath(folder));
                AssetDatabase.Refresh();
            }

            string assetPath = $"{folder}/{name}.mask";
            if (File.Exists(Path.GetFullPath(assetPath)))
                return CommandResult.Fail($"AvatarMask already exists at '{assetPath}'.");

            var mask = new AvatarMask { name = name };
            AssetDatabase.CreateAsset(mask, assetPath);

            ApplyMaskUpdate(mask, args, out string applyErr);
            if (!string.IsNullOrEmpty(applyErr)) return CommandResult.Fail(applyErr);

            EditorUtility.SetDirty(mask);
            AssetDatabase.SaveAssets();

            return CommandResult.Ok(SimpleJson.Object()
                .Put("created", true)
                .Put("assetPath", assetPath)
                .Put("name", name)
                .Put("humanoidPartCount", (int)AvatarMaskBodyPart.LastBodyPart)
                .Put("transformCount", mask.transformCount)
                .ToString());
        }

        public static CommandResult SetAvatarMask(Dictionary<string, object> args)
        {
            string assetPath = AssetOps.ResolveAssetPath(args);
            if (string.IsNullOrEmpty(assetPath)) return CommandResult.Fail("'assetPath' or 'guid' is required.");
            var mask = AssetDatabase.LoadAssetAtPath<AvatarMask>(assetPath);
            if (mask == null) return CommandResult.Fail($"AvatarMask not found at '{assetPath}'.");

            ApplyMaskUpdate(mask, args, out string applyErr);
            if (!string.IsNullOrEmpty(applyErr)) return CommandResult.Fail(applyErr);

            EditorUtility.SetDirty(mask);
            AssetDatabase.SaveAssets();

            return CommandResult.Ok(SimpleJson.Object()
                .Put("set", true)
                .Put("assetPath", assetPath)
                .Put("transformCount", mask.transformCount)
                .ToString());
        }

        public static CommandResult InspectAvatarMask(Dictionary<string, object> args)
        {
            string assetPath = AssetOps.ResolveAssetPath(args);
            if (string.IsNullOrEmpty(assetPath)) return CommandResult.Fail("'assetPath' or 'guid' is required.");
            var mask = AssetDatabase.LoadAssetAtPath<AvatarMask>(assetPath);
            if (mask == null) return CommandResult.Fail($"AvatarMask not found at '{assetPath}'.");

            var humanoid = SimpleJson.Object();
            for (int i = 0; i < (int)AvatarMaskBodyPart.LastBodyPart; i++)
            {
                var part = (AvatarMaskBodyPart)i;
                humanoid.Put(part.ToString(), mask.GetHumanoidBodyPartActive(part));
            }

            var transforms = SimpleJson.Array();
            for (int i = 0; i < mask.transformCount; i++)
            {
                transforms.AddRaw(SimpleJson.Object()
                    .Put("path", mask.GetTransformPath(i))
                    .Put("active", mask.GetTransformActive(i))
                    .ToString());
            }

            return CommandResult.Ok(SimpleJson.Object()
                .Put("assetPath", assetPath)
                .Put("name", mask.name)
                .PutRaw("humanoid", humanoid.ToString())
                .Put("transformCount", mask.transformCount)
                .PutRaw("transforms", transforms.ToString())
                .ToString());
        }

        static void ApplyMaskUpdate(AvatarMask mask, Dictionary<string, object> args, out string error)
        {
            error = null;

            object humanoidRaw = SimpleJson.GetValue(args, "humanoid");
            if (humanoidRaw is Dictionary<string, object> humanoidDict)
            {
                foreach (var kv in humanoidDict)
                {
                    if (!Enum.TryParse(kv.Key, true, out AvatarMaskBodyPart part))
                    {
                        error = $"Unknown humanoid body part '{kv.Key}'. Valid: Root, Body, Head, LeftLeg, RightLeg, LeftArm, RightArm, LeftFingers, RightFingers, LeftFootIK, RightFootIK, LeftHandIK, RightHandIK.";
                        return;
                    }
                    bool active = kv.Value is bool b ? b : Convert.ToBoolean(kv.Value);
                    mask.SetHumanoidBodyPartActive(part, active);
                }
            }

            object transformsRaw = SimpleJson.GetValue(args, "transforms");
            if (transformsRaw is List<object> transformsList)
            {
                mask.transformCount = transformsList.Count;
                for (int i = 0; i < transformsList.Count; i++)
                {
                    if (!(transformsList[i] is Dictionary<string, object> t))
                    {
                        error = "Each transform entry must be {path, active}.";
                        return;
                    }
                    string p = SimpleJson.GetString(t, "path", "");
                    bool a = SimpleJson.GetBool(t, "active", true);
                    mask.SetTransformPath(i, p);
                    mask.SetTransformActive(i, a);
                }
            }
        }
    }
}
