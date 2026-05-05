using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEngine;
using Dreamer.AgentBridge;

namespace Dreamer.AgentBridge.FX
{
    /// <summary>
    /// capture-particle: deterministic ParticleSystem.Simulate-driven multi-frame screenshots.
    /// Asset-only (Phase 1) — instantiates the prefab into a PreviewRenderUtility scene so
    /// the user's active scene is untouched. Each frame is rendered after Simulate(t, withChildren=true,
    /// restart=true, fixedTimeStep=true), giving reproducible output regardless of editor frame rate.
    /// </summary>
    public static class ParticleCaptureOps
    {
        const string DefaultDir = "DreamerScreenshots";

        public static CommandResult CaptureParticle(Dictionary<string, object> args)
        {
            string assetPath = AssetOps.ResolveAssetPath(args);
            if (assetPath == null)
                return CommandResult.Fail("Provide 'assetPath' or 'guid' (path to a prefab containing a ParticleSystem).");
            if (!assetPath.EndsWith(".prefab", StringComparison.OrdinalIgnoreCase))
                return CommandResult.Fail($"'{assetPath}' is not a .prefab. capture-particle handles GameObject prefabs only (Phase 1).");

            int width  = SimpleJson.GetInt(args, "width", 512);
            int height = SimpleJson.GetInt(args, "height", 512);
            if (width <= 0 || height <= 0 || width > 4096 || height > 4096)
                return CommandResult.Fail("'width' and 'height' must be in (0, 4096].");

            int frames = SimpleJson.GetInt(args, "frames", 5);
            if (frames < 1 || frames > 60)
                return CommandResult.Fail("'frames' must be in [1, 60].");

            float? userDuration = null;
            if (args.TryGetValue("duration", out object durObj) && durObj != null)
                userDuration = ToFloat(durObj);

            List<float> explicitTimes = null;
            if (args.TryGetValue("times", out object timesObj) && timesObj is List<object> timesArr)
            {
                explicitTimes = timesArr.Select(o => ToFloat(o)).Where(f => f >= 0f).ToList();
                if (explicitTimes.Count == 0) explicitTimes = null;
            }

            string angleArg = SimpleJson.GetString(args, "angle");
            string angle = string.IsNullOrEmpty(angleArg) ? "front" : angleArg;

            int? seed = null;
            if (args.TryGetValue("seed", out object seedObj) && seedObj != null)
                seed = SimpleJson.GetInt(args, "seed", 0);

            Color background;
            if (args.TryGetValue("backgroundColor", out object bgObj))
            {
                if (!TryParseColor(bgObj, out background, out string colorErr))
                    return CommandResult.Fail(colorErr);
            }
            else
            {
                background = new Color(0f, 0f, 0f, 1f);
            }
            bool transparent = SimpleJson.GetBool(args, "transparent", false);
            if (transparent) background = new Color(0f, 0f, 0f, 0f);

            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(assetPath);
            if (prefab == null)
                return CommandResult.Fail($"Failed to load prefab at '{assetPath}'.");

            // Verify there's at least one ParticleSystem in the prefab subtree before spawning.
            var prefabSystems = prefab.GetComponentsInChildren<ParticleSystem>(true);
            if (prefabSystems.Length == 0)
                return CommandResult.Fail($"'{assetPath}' contains no ParticleSystem components. capture-particle requires at least one.");

            PreviewRenderUtility pru = null;
            GameObject instance = null;
            try
            {
                pru = new PreviewRenderUtility();
                pru.camera.clearFlags = CameraClearFlags.SolidColor;
                pru.camera.backgroundColor = background;
                pru.camera.allowHDR = false;
                pru.camera.fieldOfView = 30f;
                pru.camera.nearClipPlane = 0.05f;
                pru.camera.farClipPlane = 5000f;
                pru.camera.cullingMask = ~0;

                if (pru.lights != null && pru.lights.Length >= 2)
                {
                    pru.lights[0].intensity = 1.2f;
                    pru.lights[0].transform.rotation = Quaternion.Euler(35f, 35f, 0f);
                    pru.lights[1].intensity = 0.55f;
                    pru.lights[1].transform.rotation = Quaternion.Euler(-25f, -160f, 0f);
                }
                pru.ambientColor = new Color(0.4f, 0.4f, 0.45f);

                instance = UnityEngine.Object.Instantiate(prefab);
                instance.hideFlags = HideFlags.HideAndDontSave;
                instance.transform.position = Vector3.zero;
                instance.transform.rotation = Quaternion.identity;
                pru.AddSingleGO(instance);

                var systems = instance.GetComponentsInChildren<ParticleSystem>(true);
                if (systems.Length == 0)
                    return CommandResult.Fail("Instantiated prefab has no ParticleSystem (lost during instantiation?).");

                // Drive Simulate from the top-level systems only — calling Simulate(withChildren=true)
                // on each root walks the parent→child chain so sub-emitters receive the right events.
                // Calling on every PS individually with withChildren=false would skip sub-emitter
                // birth/death events. Find roots = systems whose ancestor chain has no other PS above.
                var roots = systems.Where(ps => !HasParticleAncestor(ps.transform, instance.transform)).ToArray();
                if (roots.Length == 0) roots = systems; // pathological — shouldn't happen, but fall back.

                // Lock seeds so output is reproducible across captures of the same asset.
                foreach (var ps in systems)
                {
                    ps.useAutoRandomSeed = false;
                    if (seed.HasValue) ps.randomSeed = (uint)seed.Value;
                }

                // Resolve duration: explicit > main.duration of root system (or its longest descendant if root is brief).
                float rootDuration = systems.Max(p => p.main.duration);
                bool anyLoops = systems.Any(p => p.main.loop);
                float duration = userDuration
                    ?? (rootDuration > 0.05f ? rootDuration : 2.0f);
                if (anyLoops && !userDuration.HasValue && duration < 1.0f)
                    duration = Mathf.Max(duration, 1.0f);

                // Compute frame times.
                List<float> frameTimes;
                if (explicitTimes != null)
                {
                    frameTimes = explicitTimes;
                    duration = explicitTimes.Max();
                }
                else
                {
                    frameTimes = new List<float>(frames);
                    if (frames == 1)
                        frameTimes.Add(duration * 0.5f);
                    else
                        for (int i = 0; i < frames; i++)
                            frameTimes.Add(duration * (i / (float)(frames - 1)));
                }

                // Pass A: bounds discovery — accumulate Renderer.bounds across all frame times so the
                // camera frames the entire effect, not just the first puff.
                Bounds? boundsAcc = null;
                foreach (var t in frameTimes)
                {
                    SimulateAll(roots, t);
                    var b = ComputeParticleBounds(instance, systems);
                    if (b.HasValue)
                    {
                        if (boundsAcc.HasValue)
                        {
                            var tmp = boundsAcc.Value;
                            tmp.Encapsulate(b.Value);
                            boundsAcc = tmp;
                        }
                        else boundsAcc = b.Value;
                    }
                }
                Bounds bounds = boundsAcc ?? new Bounds(Vector3.zero, Vector3.one * 2f);
                if (bounds.size.magnitude < 0.01f) bounds.size = Vector3.one * 2f;

                // Camera positioning — front-by-default mirroring screenshot-prefab.
                Vector3 dirLocal = AngleToCameraDir(angle);
                pru.camera.orthographic = false;
                float radius = Mathf.Max(bounds.extents.magnitude, 0.5f);
                float distance = radius / Mathf.Sin(pru.camera.fieldOfView * 0.5f * Mathf.Deg2Rad);
                pru.camera.transform.position = bounds.center + dirLocal.normalized * distance * 1.4f;
                pru.camera.transform.LookAt(bounds.center);

                // Pass B: capture each frame.
                EnsureScreenshotDir();
                string assetGuid = AssetDatabase.AssetPathToGUID(assetPath);
                string stem = Path.GetFileNameWithoutExtension(assetPath);
                long ticks = DateTime.UtcNow.Ticks;

                var framesJson = SimpleJson.Array();
                long totalBytes = 0;
                foreach (var t in frameTimes)
                {
                    SimulateAll(roots, t);

                    var rt = RenderTexture.GetTemporary(width, height, 24, RenderTextureFormat.ARGB32);
                    rt.Create();
                    var prevTarget = pru.camera.targetTexture;
                    var prevActive = RenderTexture.active;
                    Texture2D rendered = null;
                    try
                    {
                        pru.camera.targetTexture = rt;
                        RenderTexture.active = rt;
                        GL.Clear(true, true, background);
                        pru.camera.Render();
                        rendered = new Texture2D(width, height, TextureFormat.RGBA32, mipChain: false);
                        rendered.ReadPixels(new Rect(0, 0, width, height), 0, 0);
                        rendered.Apply();
                    }
                    finally
                    {
                        RenderTexture.active = prevActive;
                        pru.camera.targetTexture = prevTarget;
                        RenderTexture.ReleaseTemporary(rt);
                    }
                    if (rendered == null)
                        return CommandResult.Fail("Render returned null. Likely cause: graphics device unavailable (headless/batch without -nographics workaround), or Unity is unfocused on a platform that throttles render.");

                    byte[] png = rendered.EncodeToPNG();
                    UnityEngine.Object.DestroyImmediate(rendered);

                    int msec = Mathf.RoundToInt(t * 1000f);
                    string savePath = Path.Combine(DefaultDir, $"particle-{stem}-{assetGuid.Substring(0, 8)}-{ticks}-t{msec:D5}.png").Replace('\\', '/');
                    File.WriteAllBytes(savePath, png);
                    totalBytes += png.Length;

                    framesJson.AddRaw(SimpleJson.Object()
                        .Put("time", t)
                        .Put("path", savePath)
                        .Put("byteCount", png.Length)
                        .ToString());
                }

                return CommandResult.Ok(SimpleJson.Object()
                    .Put("captured", true)
                    .Put("assetPath", assetPath)
                    .Put("rootName", instance.name.Replace("(Clone)", ""))
                    .Put("particleSystems", systems.Length)
                    .Put("loops", anyLoops)
                    .Put("duration", duration)
                    .Put("width", width)
                    .Put("height", height)
                    .PutRaw("bounds", BoundsJson(bounds).ToString())
                    .PutRaw("frames", framesJson.ToString())
                    .Put("totalByteCount", totalBytes)
                    .Put("hint", "Open each frame's `path` with the Read tool to view it. `time` is the simulated seconds-since-start. Use `set-particle-property` to tweak, then re-capture to compare.")
                    .ToString());
            }
            finally
            {
                if (instance != null) UnityEngine.Object.DestroyImmediate(instance);
                if (pru != null) pru.Cleanup();
            }
        }

        // ── helpers ────────────────────────────────────────────────────────

        static void SimulateAll(ParticleSystem[] roots, float t)
        {
            // Always restart with fixed time-step so output is identical for the same (asset, t, seed)
            // tuple. withChildren=true on each root drives the sub-emitter chain so birth/death events fire.
            foreach (var ps in roots)
                ps.Simulate(t, withChildren: true, restart: true, fixedTimeStep: true);
        }

        static bool HasParticleAncestor(Transform self, Transform stopAt)
        {
            for (var t = self.parent; t != null && t != stopAt; t = t.parent)
                if (t.GetComponent<ParticleSystem>() != null) return true;
            return false;
        }

        static Bounds? ComputeParticleBounds(GameObject root, ParticleSystem[] systems)
        {
            Bounds? acc = null;
            // Renderer.bounds covers actually-emitted particles. ParticleSystemRenderer is the renderer
            // type that owns the visible mesh; falls back to plain Renderers (e.g. trail Renderer).
            foreach (var r in root.GetComponentsInChildren<Renderer>(true))
            {
                if (!r.enabled) continue;
                var b = r.bounds;
                if (b.size.sqrMagnitude < 1e-6f) continue;
                if (acc.HasValue) { var tmp = acc.Value; tmp.Encapsulate(b); acc = tmp; }
                else acc = b;
            }
            // Fallback: if no particle has been emitted yet (Simulate at t=0 on a one-shot system),
            // use each ParticleSystem's shape module radius as a hint.
            if (!acc.HasValue)
            {
                foreach (var ps in systems)
                {
                    var shape = ps.shape;
                    float r = shape.enabled ? Mathf.Max(shape.radius, 0.5f) : 0.5f;
                    var b = new Bounds(ps.transform.position, Vector3.one * r * 2f);
                    if (acc.HasValue) { var tmp = acc.Value; tmp.Encapsulate(b); acc = tmp; }
                    else acc = b;
                }
            }
            return acc;
        }

        static Vector3 AngleToCameraDir(string angle)
        {
            switch ((angle ?? "front").ToLowerInvariant())
            {
                case "front":      return new Vector3(0f, 0f, -1f);
                case "back":       return new Vector3(0f, 0f, 1f);
                case "left":       return new Vector3(-1f, 0f, 0f);
                case "right":      return new Vector3(1f, 0f, 0f);
                case "top":        return new Vector3(0f, 1f, 0f);
                case "bottom":     return new Vector3(0f, -1f, 0f);
                case "iso":        return new Vector3(-0.7f, 0.5f, -0.7f);
                case "iso-front":  return new Vector3(-0.4f, 0.3f, -0.9f);
                default:           return new Vector3(0f, 0f, -1f);
            }
        }

        static bool TryParseColor(object raw, out Color color, out string error)
        {
            color = Color.black;
            error = null;
            if (raw is string s)
            {
                if (s.StartsWith("#")) s = s.Substring(1);
                if (s.Length == 6) s += "FF";
                if (s.Length != 8) { error = $"backgroundColor: expected '#RRGGBB' or '#RRGGBBAA', got '{raw}'."; return false; }
                if (!uint.TryParse(s, System.Globalization.NumberStyles.HexNumber, System.Globalization.CultureInfo.InvariantCulture, out uint rgba))
                { error = $"backgroundColor: invalid hex '{raw}'."; return false; }
                color = new Color(((rgba >> 24) & 0xFF) / 255f, ((rgba >> 16) & 0xFF) / 255f, ((rgba >> 8) & 0xFF) / 255f, (rgba & 0xFF) / 255f);
                return true;
            }
            if (raw is Dictionary<string, object> d)
            {
                color = new Color(
                    (float)ToFloat(d.TryGetValue("r", out var r) ? r : 0f),
                    (float)ToFloat(d.TryGetValue("g", out var g) ? g : 0f),
                    (float)ToFloat(d.TryGetValue("b", out var bV) ? bV : 0f),
                    (float)ToFloat(d.TryGetValue("a", out var a) ? a : 1f));
                return true;
            }
            error = $"backgroundColor: expected hex string or {{r,g,b,a}} object.";
            return false;
        }

        static float ToFloat(object o)
        {
            if (o is double d) return (float)d;
            if (o is float f) return f;
            if (o is int i) return i;
            if (o is long l) return l;
            if (o is string s && float.TryParse(s, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out float r)) return r;
            return 0f;
        }

        static void EnsureScreenshotDir()
        {
            if (!Directory.Exists(DefaultDir))
            {
                Directory.CreateDirectory(DefaultDir);
                File.WriteAllText(Path.Combine(DefaultDir, ".gitignore"), "*\n!.gitignore\n");
            }
        }

        static JsonBuilder BoundsJson(Bounds b) =>
            SimpleJson.Object()
                .PutRaw("center", $"[{b.center.x:F3},{b.center.y:F3},{b.center.z:F3}]")
                .PutRaw("size",   $"[{b.size.x:F3},{b.size.y:F3},{b.size.z:F3}]");
    }
}
