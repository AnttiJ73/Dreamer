using System;
using System.Collections.Generic;
using System.IO;
using UnityEditor;
using UnityEngine;

namespace Dreamer.AgentBridge.Animation
{
    /// <summary>
    /// AnimationClip authoring — create clips, write/replace float-curve bindings,
    /// inspect existing clips, and sample curves to a numeric (t, v) table that
    /// the agent can read to verify the curve evaluates as intended.
    ///
    /// Float-curve bindings only for v1. ObjectReference curves (sprite swap,
    /// active toggles) and AnimatorController state-machine commands ship later.
    /// </summary>
    public static class AnimationClipOps
    {
        // ── create-animation-clip ─────────────────────────────────────────

        public static CommandResult CreateAnimationClip(Dictionary<string, object> args)
        {
            string name = SimpleJson.GetString(args, "name");
            if (string.IsNullOrEmpty(name))
                return CommandResult.Fail("'name' is required.");

            string folder = SimpleJson.GetString(args, "path", "Assets/Animations");
            float frameRate = (float)GetDouble(args, "frameRate", 30.0);
            bool loop = SimpleJson.GetBool(args, "loop", false);

            if (!AssetDatabase.IsValidFolder(folder))
            {
                string fullDir = Path.GetFullPath(folder);
                if (!Directory.Exists(fullDir))
                {
                    Directory.CreateDirectory(fullDir);
                    AssetDatabase.Refresh();
                }
            }

            string assetPath = $"{folder}/{name}.anim";
            if (File.Exists(Path.GetFullPath(assetPath)))
                return CommandResult.Fail($"Animation clip already exists at '{assetPath}'. Use a different --name or delete the existing asset first.");

            var clip = new AnimationClip { frameRate = frameRate, name = name };
            // Apply loop via clip settings.
            if (loop)
            {
                var settings = AnimationUtility.GetAnimationClipSettings(clip);
                settings.loopTime = true;
                AnimationUtility.SetAnimationClipSettings(clip, settings);
            }

            AssetDatabase.CreateAsset(clip, assetPath);
            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();

            var json = SimpleJson.Object()
                .Put("created", true)
                .Put("assetPath", assetPath)
                .Put("name", name)
                .Put("frameRate", frameRate)
                .Put("loop", loop)
                .ToString();
            return CommandResult.Ok(json);
        }

        // ── set-animation-curve ───────────────────────────────────────────

        public static CommandResult SetAnimationCurve(Dictionary<string, object> args)
        {
            string assetPath = AssetOps.ResolveAssetPath(args);
            if (string.IsNullOrEmpty(assetPath))
                return CommandResult.Fail("'assetPath' or 'guid' is required.");

            var clip = AssetDatabase.LoadAssetAtPath<AnimationClip>(assetPath);
            if (clip == null)
                return CommandResult.Fail($"Failed to load AnimationClip at '{assetPath}'.");

            string target = SimpleJson.GetString(args, "target") ?? "";
            target = NormalizeTargetPath(target);
            string componentTypeName = SimpleJson.GetString(args, "componentType");
            if (string.IsNullOrEmpty(componentTypeName))
                return CommandResult.Fail("'componentType' is required (e.g. 'UnityEngine.Transform').");
            string propertyName = SimpleJson.GetString(args, "propertyName");
            if (string.IsNullOrEmpty(propertyName))
                return CommandResult.Fail("'propertyName' is required (e.g. 'm_LocalPosition.y').");

            Type compType = ComponentOps.ResolveType(componentTypeName);
            if (compType == null)
                return CommandResult.Fail($"Component type '{componentTypeName}' not found.");

            object keysRaw = SimpleJson.GetValue(args, "keys");
            if (!(keysRaw is List<object> keysList))
                return CommandResult.Fail("'keys' must be a JSON array of {t, v, interp?, inTangent?, outTangent?, ...} objects.");
            if (keysList.Count == 0)
                return CommandResult.Fail("'keys' is empty — pass at least one keyframe.");

            string buildErr = BuildCurve(keysList, out AnimationCurve curve, out List<TangentSpec> tangentSpecs);
            if (buildErr != null) return CommandResult.Fail(buildErr);

            var binding = new EditorCurveBinding
            {
                path = target,
                type = compType,
                propertyName = propertyName,
            };

            AnimationUtility.SetEditorCurve(clip, binding, curve);

            // After SetEditorCurve, the curve's keys are stored — apply tangent
            // modes per-key to honor "linear" / "constant" / "auto" requests.
            // For "free" mode, the inTangent/outTangent values applied at build
            // time stay as-is.
            ApplyTangentModes(clip, binding, tangentSpecs);

            EditorUtility.SetDirty(clip);
            AssetDatabase.SaveAssets();

            var sumJson = SummarizeCurve(curve);
            var json = SimpleJson.Object()
                .Put("set", true)
                .Put("assetPath", assetPath)
                .Put("target", target)
                .Put("componentType", compType.FullName)
                .Put("propertyName", propertyName)
                .Put("keyCount", curve.length)
                .PutRaw("summary", sumJson)
                .ToString();
            return CommandResult.Ok(json);
        }

        // ── inspect-animation-clip ────────────────────────────────────────

        public static CommandResult InspectAnimationClip(Dictionary<string, object> args)
        {
            string assetPath = AssetOps.ResolveAssetPath(args);
            if (string.IsNullOrEmpty(assetPath))
                return CommandResult.Fail("'assetPath' or 'guid' is required.");

            var clip = AssetDatabase.LoadAssetAtPath<AnimationClip>(assetPath);
            if (clip == null)
                return CommandResult.Fail($"Failed to load AnimationClip at '{assetPath}'.");

            var settings = AnimationUtility.GetAnimationClipSettings(clip);
            var bindings = AnimationUtility.GetCurveBindings(clip);

            var bindingsJson = SimpleJson.Array();
            foreach (var b in bindings)
            {
                var c = AnimationUtility.GetEditorCurve(clip, b);
                if (c == null) continue;
                var item = SimpleJson.Object()
                    .Put("target", string.IsNullOrEmpty(b.path) ? "" : b.path)
                    .Put("componentType", b.type != null ? b.type.FullName : null)
                    .Put("propertyName", b.propertyName)
                    .Put("keyCount", c.length)
                    .PutRaw("summary", SummarizeCurve(c));
                bindingsJson.AddRaw(item.ToString());
            }

            // Object-reference curves (sprite swaps etc.) — list separately.
            var objBindings = AnimationUtility.GetObjectReferenceCurveBindings(clip);
            var objJson = SimpleJson.Array();
            foreach (var b in objBindings)
            {
                var keys = AnimationUtility.GetObjectReferenceCurve(clip, b);
                int n = keys != null ? keys.Length : 0;
                var item = SimpleJson.Object()
                    .Put("target", string.IsNullOrEmpty(b.path) ? "" : b.path)
                    .Put("componentType", b.type != null ? b.type.FullName : null)
                    .Put("propertyName", b.propertyName)
                    .Put("keyCount", n)
                    .Put("note", "object-reference curve (not editable via set-animation-curve in v1)");
                objJson.AddRaw(item.ToString());
            }

            var json = SimpleJson.Object()
                .Put("assetPath", assetPath)
                .Put("name", clip.name)
                .Put("length", clip.length)
                .Put("frameRate", clip.frameRate)
                .Put("loop", settings.loopTime)
                .Put("loopBlend", settings.loopBlend)
                .Put("isLooping", clip.isLooping)
                .Put("bindingCount", bindings.Length)
                .PutRaw("bindings", bindingsJson.ToString())
                .Put("objectReferenceBindingCount", objBindings.Length)
                .PutRaw("objectReferenceBindings", objJson.ToString())
                .ToString();
            return CommandResult.Ok(json);
        }

        // ── sample-animation-curve ────────────────────────────────────────

        public static CommandResult SampleAnimationCurve(Dictionary<string, object> args)
        {
            string assetPath = AssetOps.ResolveAssetPath(args);
            if (string.IsNullOrEmpty(assetPath))
                return CommandResult.Fail("'assetPath' or 'guid' is required.");

            var clip = AssetDatabase.LoadAssetAtPath<AnimationClip>(assetPath);
            if (clip == null)
                return CommandResult.Fail($"Failed to load AnimationClip at '{assetPath}'.");

            string target = NormalizeTargetPath(SimpleJson.GetString(args, "target") ?? "");
            string componentTypeName = SimpleJson.GetString(args, "componentType");
            if (string.IsNullOrEmpty(componentTypeName))
                return CommandResult.Fail("'componentType' is required.");
            string propertyName = SimpleJson.GetString(args, "propertyName");
            if (string.IsNullOrEmpty(propertyName))
                return CommandResult.Fail("'propertyName' is required.");

            Type compType = ComponentOps.ResolveType(componentTypeName);
            if (compType == null)
                return CommandResult.Fail($"Component type '{componentTypeName}' not found.");

            var binding = new EditorCurveBinding { path = target, type = compType, propertyName = propertyName };
            var curve = AnimationUtility.GetEditorCurve(clip, binding);
            if (curve == null)
                return CommandResult.Fail($"No curve found at target='{target}', component='{componentTypeName}', property='{propertyName}'. Run inspect-animation-clip to list available bindings.");

            int samples = (int)GetDouble(args, "samples", 30);
            if (samples < 2) samples = 2;
            if (samples > 1000) samples = 1000;

            float tStart = (float)GetDouble(args, "tStart", curve.length > 0 ? curve.keys[0].time : 0f);
            float tEnd = (float)GetDouble(args, "tEnd", curve.length > 0 ? curve.keys[curve.length - 1].time : 0f);
            if (tEnd <= tStart) tEnd = tStart + 1f;

            var arr = SimpleJson.Array();
            float vMin = float.PositiveInfinity, vMax = float.NegativeInfinity;
            for (int i = 0; i < samples; i++)
            {
                float t = tStart + (tEnd - tStart) * (i / (float)(samples - 1));
                float v = curve.Evaluate(t);
                if (v < vMin) vMin = v;
                if (v > vMax) vMax = v;
                var item = SimpleJson.Object()
                    .Put("t", Math.Round(t, 4))
                    .Put("v", Math.Round(v, 4));
                arr.AddRaw(item.ToString());
            }

            var bindingObj = SimpleJson.Object()
                .Put("target", target)
                .Put("componentType", compType.FullName)
                .Put("propertyName", propertyName);

            var json = SimpleJson.Object()
                .Put("assetPath", assetPath)
                .PutRaw("binding", bindingObj.ToString())
                .Put("sampleCount", samples)
                .Put("tStart", tStart)
                .Put("tEnd", tEnd)
                .Put("valueMin", float.IsInfinity(vMin) ? 0f : vMin)
                .Put("valueMax", float.IsInfinity(vMax) ? 0f : vMax)
                .PutRaw("samples", arr.ToString())
                .PutRaw("curveSummary", SummarizeCurve(curve))
                .ToString();
            return CommandResult.Ok(json);
        }

        // ── delete-animation-curve ────────────────────────────────────────

        public static CommandResult DeleteAnimationCurve(Dictionary<string, object> args)
        {
            string assetPath = AssetOps.ResolveAssetPath(args);
            if (string.IsNullOrEmpty(assetPath))
                return CommandResult.Fail("'assetPath' or 'guid' is required.");

            var clip = AssetDatabase.LoadAssetAtPath<AnimationClip>(assetPath);
            if (clip == null)
                return CommandResult.Fail($"Failed to load AnimationClip at '{assetPath}'.");

            string target = NormalizeTargetPath(SimpleJson.GetString(args, "target") ?? "");
            string componentTypeName = SimpleJson.GetString(args, "componentType");
            if (string.IsNullOrEmpty(componentTypeName))
                return CommandResult.Fail("'componentType' is required.");
            string propertyName = SimpleJson.GetString(args, "propertyName");
            if (string.IsNullOrEmpty(propertyName))
                return CommandResult.Fail("'propertyName' is required.");

            Type compType = ComponentOps.ResolveType(componentTypeName);
            if (compType == null)
                return CommandResult.Fail($"Component type '{componentTypeName}' not found.");

            var binding = new EditorCurveBinding { path = target, type = compType, propertyName = propertyName };
            var curve = AnimationUtility.GetEditorCurve(clip, binding);
            if (curve == null)
                return CommandResult.Fail($"No curve at target='{target}', component='{componentTypeName}', property='{propertyName}'. Nothing to delete.");

            AnimationUtility.SetEditorCurve(clip, binding, null);
            EditorUtility.SetDirty(clip);
            AssetDatabase.SaveAssets();

            var json = SimpleJson.Object()
                .Put("deleted", true)
                .Put("assetPath", assetPath)
                .Put("target", target)
                .Put("componentType", compType.FullName)
                .Put("propertyName", propertyName)
                .ToString();
            return CommandResult.Ok(json);
        }

        // ── helpers ───────────────────────────────────────────────────────

        struct TangentSpec
        {
            public AnimationUtility.TangentMode left;
            public AnimationUtility.TangentMode right;
            public bool freeMode;  // when true, leave the values from the Keyframe build alone
        }

        static string BuildCurve(List<object> keysList, out AnimationCurve curve, out List<TangentSpec> tangentSpecs)
        {
            curve = new AnimationCurve();
            tangentSpecs = new List<TangentSpec>();
            for (int i = 0; i < keysList.Count; i++)
            {
                if (!(keysList[i] is Dictionary<string, object> k))
                    return $"keys[{i}] must be an object with at least 't' and 'v'.";

                if (!TryGetFloat(k, "t", out float t))
                    return $"keys[{i}].t (time) is required (number).";
                if (!TryGetFloat(k, "v", out float v))
                    return $"keys[{i}].v (value) is required (number).";

                float inTan = TryGetFloat(k, "inTangent",  out float inT) ? inT : 0f;
                float outTan = TryGetFloat(k, "outTangent", out float outT) ? outT : 0f;
                float inWt   = TryGetFloat(k, "inWeight",   out float iw) ? iw : 0f;
                float outWt  = TryGetFloat(k, "outWeight",  out float ow) ? ow : 0f;
                bool weighted = k.ContainsKey("inWeight") || k.ContainsKey("outWeight");

                var kf = new Keyframe(t, v, inTan, outTan)
                {
                    inWeight = weighted ? inWt : 1f / 3f,
                    outWeight = weighted ? outWt : 1f / 3f,
                    weightedMode = weighted ? WeightedMode.Both : WeightedMode.None,
                };
                curve.AddKey(kf);

                string interp = SimpleJson.GetString(k, "interp", "linear");
                tangentSpecs.Add(SpecForInterp(interp, k));
            }
            return null;
        }

        static TangentSpec SpecForInterp(string interp, Dictionary<string, object> key)
        {
            // "free" = keep the explicit inTangent/outTangent the build placed
            // on the Keyframe. Anything else uses Unity's tangent-mode setter.
            switch (interp)
            {
                case "linear":
                    return new TangentSpec { left = AnimationUtility.TangentMode.Linear, right = AnimationUtility.TangentMode.Linear };
                case "constant":
                    return new TangentSpec { left = AnimationUtility.TangentMode.Constant, right = AnimationUtility.TangentMode.Constant };
                case "auto":
                    return new TangentSpec { left = AnimationUtility.TangentMode.Auto, right = AnimationUtility.TangentMode.Auto };
                case "clamped":
                    return new TangentSpec { left = AnimationUtility.TangentMode.ClampedAuto, right = AnimationUtility.TangentMode.ClampedAuto };
                case "free":
                    return new TangentSpec { freeMode = true };
                default:
                    return new TangentSpec { left = AnimationUtility.TangentMode.Linear, right = AnimationUtility.TangentMode.Linear };
            }
        }

        static void ApplyTangentModes(AnimationClip clip, EditorCurveBinding binding, List<TangentSpec> specs)
        {
            // Re-fetch — SetEditorCurve may have stored a normalized copy.
            var fresh = AnimationUtility.GetEditorCurve(clip, binding);
            if (fresh == null) return;
            for (int i = 0; i < fresh.length && i < specs.Count; i++)
            {
                var s = specs[i];
                if (s.freeMode) continue;
                AnimationUtility.SetKeyLeftTangentMode(fresh, i, s.left);
                AnimationUtility.SetKeyRightTangentMode(fresh, i, s.right);
            }
            // Write the curve back so tangent-mode side-effects on the Keyframe
            // tangent values stick.
            AnimationUtility.SetEditorCurve(clip, binding, fresh);
        }

        static string SummarizeCurve(AnimationCurve curve)
        {
            if (curve == null || curve.length == 0)
            {
                return SimpleJson.Object()
                    .Put("keyCount", 0)
                    .ToString();
            }
            float tMin = curve.keys[0].time;
            float tMax = curve.keys[curve.length - 1].time;
            float vMin = float.PositiveInfinity, vMax = float.NegativeInfinity;
            for (int i = 0; i < curve.length; i++)
            {
                var k = curve.keys[i];
                if (k.value < vMin) vMin = k.value;
                if (k.value > vMax) vMax = k.value;
            }
            // The actual rendered min/max can be outside keyframe values when
            // tangents overshoot — sample 17 times to get a tighter estimate.
            const int probe = 17;
            for (int i = 0; i < probe; i++)
            {
                float t = tMin + (tMax - tMin) * (i / (float)(probe - 1));
                float v = curve.Evaluate(t);
                if (v < vMin) vMin = v;
                if (v > vMax) vMax = v;
            }
            return SimpleJson.Object()
                .Put("keyCount", curve.length)
                .Put("timeMin", tMin)
                .Put("timeMax", tMax)
                .Put("duration", tMax - tMin)
                .Put("valueMin", vMin)
                .Put("valueMax", vMax)
                .ToString();
        }

        static string NormalizeTargetPath(string target)
        {
            // AnimationUtility expects relative paths with no leading slash.
            // Empty string = root (the GO with the Animator/Animation).
            if (string.IsNullOrEmpty(target)) return "";
            return target.TrimStart('/');
        }

        static double GetDouble(Dictionary<string, object> args, string key, double fallback)
        {
            if (args == null || !args.ContainsKey(key) || args[key] == null) return fallback;
            try
            {
                return Convert.ToDouble(args[key], System.Globalization.CultureInfo.InvariantCulture);
            }
            catch { return fallback; }
        }

        static bool TryGetFloat(Dictionary<string, object> args, string key, out float v)
        {
            v = 0f;
            if (args == null || !args.ContainsKey(key) || args[key] == null) return false;
            try
            {
                v = Convert.ToSingle(args[key], System.Globalization.CultureInfo.InvariantCulture);
                return true;
            }
            catch { return false; }
        }
    }
}
