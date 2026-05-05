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

            // --auto-material: ensure every PSR has a placeholder material before we capture,
            // so the user doesn't get a black/magenta image from a freshly-created prefab.
            if (SimpleJson.GetBool(args, "autoMaterial", false))
            {
                var prsList = prefab.GetComponentsInChildren<ParticleSystemRenderer>(true);
                bool needsSetup = false;
                foreach (var r in prsList) if (r.sharedMaterial == null) { needsSetup = true; break; }
                if (needsSetup)
                {
                    var setupArgs = new Dictionary<string, object> { { "assetPath", assetPath } };
                    var setupResult = ParticleMaterialOps.SetupParticleMaterial(setupArgs);
                    if (!setupResult.success)
                        return CommandResult.Fail("auto-material failed: " + setupResult.error);
                    // Reload prefab now that the material has been assigned + saved.
                    prefab = AssetDatabase.LoadAssetAtPath<GameObject>(assetPath);
                }
            }

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

                // Pass B: capture each frame into memory, compose into a grid.
                EnsureScreenshotDir();
                string assetGuid = AssetDatabase.AssetPathToGUID(assetPath);
                string stem = Path.GetFileNameWithoutExtension(assetPath);
                long ticks = DateTime.UtcNow.Ticks;
                bool individualFrames = SimpleJson.GetBool(args, "individualFrames", false);
                bool emitGif = SimpleJson.GetBool(args, "gif", true);
                int gifDelayMs = SimpleJson.GetInt(args, "gifDelayMs", 0);
                int gifLoop = SimpleJson.GetInt(args, "gifLoop", 0);

                var rendered = new Texture2D[frameTimes.Count];
                var framesJson = SimpleJson.Array();
                long individualBytes = 0;

                // Grid layout: prefer wider-than-tall (most monitors are landscape).
                int n = frameTimes.Count;
                int cols = Mathf.Max(1, (int)Mathf.Ceil(Mathf.Sqrt(n)));
                if (n == 5) cols = 3;          // 3×2 reads better than 3×2/2×3 ambiguity
                if (n == 7 || n == 8) cols = 4; // 4×2 wider than 3×3
                if (n == 10) cols = 5;          // 5×2 explicit per user request
                int rows = Mathf.CeilToInt(n / (float)cols);

                try
                {
                    for (int i = 0; i < n; i++)
                    {
                        float t = frameTimes[i];
                        SimulateAll(roots, t);

                        var rt = RenderTexture.GetTemporary(width, height, 24, RenderTextureFormat.ARGB32);
                        rt.Create();
                        var prevTarget = pru.camera.targetTexture;
                        var prevActive = RenderTexture.active;
                        try
                        {
                            pru.camera.targetTexture = rt;
                            RenderTexture.active = rt;
                            GL.Clear(true, true, background);
                            pru.camera.Render();
                            rendered[i] = new Texture2D(width, height, TextureFormat.RGBA32, mipChain: false);
                            rendered[i].ReadPixels(new Rect(0, 0, width, height), 0, 0);
                            rendered[i].Apply();
                        }
                        finally
                        {
                            RenderTexture.active = prevActive;
                            pru.camera.targetTexture = prevTarget;
                            RenderTexture.ReleaseTemporary(rt);
                        }
                        if (rendered[i] == null)
                            return CommandResult.Fail("Render returned null. Likely cause: graphics device unavailable (headless/batch without -nographics workaround), or Unity is unfocused on a platform that throttles render.");

                        int row = i / cols;
                        int col = i % cols;

                        var frameJson = SimpleJson.Object()
                            .Put("time", t)
                            .Put("row", row)
                            .Put("col", col);

                        if (individualFrames)
                        {
                            byte[] frPng = rendered[i].EncodeToPNG();
                            int msec = Mathf.RoundToInt(t * 1000f);
                            string framePath = Path.Combine(DefaultDir, $"particle-{stem}-{assetGuid.Substring(0, 8)}-{ticks}-t{msec:D5}.png").Replace('\\', '/');
                            File.WriteAllBytes(framePath, frPng);
                            individualBytes += frPng.Length;
                            frameJson.Put("path", framePath).Put("byteCount", frPng.Length);
                        }
                        framesJson.AddRaw(frameJson.ToString());
                    }

                    // Compose grid: cell = (width × height), label strip above each cell with t=Xs.
                    int labelHeight = 22;       // px above each cell for the timestamp label
                    int gutter = 4;             // px between cells
                    int cellW = width;
                    int cellH = height + labelHeight;
                    int gridW = cols * cellW + (cols + 1) * gutter;
                    int gridH = rows * cellH + (rows + 1) * gutter;

                    var grid = new Texture2D(gridW, gridH, TextureFormat.RGBA32, mipChain: false);
                    var bg = new Color(0.08f, 0.08f, 0.10f, 1f);
                    var fill = new Color[gridW * gridH];
                    for (int p = 0; p < fill.Length; p++) fill[p] = bg;
                    grid.SetPixels(fill);

                    for (int i = 0; i < n; i++)
                    {
                        int row = i / cols;
                        int col = i % cols;
                        int cellX = gutter + col * (cellW + gutter);
                        // Y axis: Texture2D has bottom-left origin. Our grid is read top-to-bottom, so row 0 is the TOP.
                        int cellYTop = gridH - (gutter + row * (cellH + gutter));    // top of cell strip
                        int frameYBottom = cellYTop - cellH;                          // bottom of frame area
                        // Paste the rendered frame.
                        var px = rendered[i].GetPixels();
                        grid.SetPixels(cellX, frameYBottom, width, height, px);

                        // Label strip just above the frame ("t=X.XXs"). White text on dark bg.
                        int labelY = frameYBottom + height;
                        DrawLabelStrip(grid, cellX, labelY, cellW, labelHeight, $"t={frameTimes[i]:F2}s");
                    }
                    grid.Apply();

                    byte[] gridPng = grid.EncodeToPNG();
                    UnityEngine.Object.DestroyImmediate(grid);
                    string gridPath = Path.Combine(DefaultDir, $"particle-{stem}-{assetGuid.Substring(0, 8)}-{ticks}-grid.png").Replace('\\', '/');
                    File.WriteAllBytes(gridPath, gridPng);

                    // Optional GIF — animation preview, default ON. Quantizes to 256 colors.
                    // Each GIF frame gets the same `t=X.XXs` label strip the grid cells use, burned
                    // into the top of the frame canvas. Lets the user judge timing while watching the
                    // animation play (timestamps tell you how the effect develops over absolute time,
                    // not just shape order). Total cycle = duration exactly (`/N` divisor, not `/N-1`)
                    // so a 5s 10-frame capture plays back in 5s.
                    string gifPath = null;
                    long gifBytes = 0;
                    Texture2D[] gifFrames = null;
                    if (emitGif && n >= 2)
                    {
                        gifFrames = new Texture2D[n];
                        try
                        {
                            for (int i = 0; i < n; i++)
                                gifFrames[i] = BuildLabelledFrame(rendered[i], frameTimes[i], width, height, labelHeight);

                            int delay = gifDelayMs > 0
                                ? gifDelayMs
                                : Mathf.Max(40, Mathf.RoundToInt((duration / n) * 1000f));
                            byte[] gifData = GifEncoder.Encode(gifFrames, delay, gifLoop);
                            gifPath = Path.Combine(DefaultDir, $"particle-{stem}-{assetGuid.Substring(0, 8)}-{ticks}.gif").Replace('\\', '/');
                            File.WriteAllBytes(gifPath, gifData);
                            gifBytes = gifData.Length;
                        }
                        finally
                        {
                            if (gifFrames != null)
                                foreach (var t2d in gifFrames)
                                    if (t2d != null) UnityEngine.Object.DestroyImmediate(t2d);
                        }
                    }

                    var resultJson = SimpleJson.Object()
                        .Put("captured", true)
                        .Put("path", gridPath)
                        .Put("assetPath", assetPath)
                        .Put("rootName", instance.name.Replace("(Clone)", ""))
                        .Put("particleSystems", systems.Length)
                        .Put("loops", anyLoops)
                        .Put("duration", duration)
                        .Put("cellWidth", width)
                        .Put("cellHeight", height)
                        .Put("gridWidth", gridW)
                        .Put("gridHeight", gridH)
                        .Put("cols", cols)
                        .Put("rows", rows)
                        .Put("frameCount", n)
                        .PutRaw("bounds", BoundsJson(bounds).ToString())
                        .PutRaw("frames", framesJson.ToString())
                        .Put("byteCount", gridPng.Length)
                        .Put("individualByteCount", individualBytes);
                    if (gifPath != null)
                    {
                        resultJson.Put("gifPath", gifPath).Put("gifByteCount", gifBytes);
                    }
                    resultJson.Put("hint", gifPath != null
                        ? "`path` is the static grid PNG (good for diff comparison). `gifPath` is an animated GIF that loops the same frames — open it in any image viewer to see the effect play. Use `--individual-frames` to also save per-frame PNGs; `--no-gif` to skip GIF generation."
                        : "`path` is a single grid image with all frames laid out left-to-right, top-to-bottom. Each cell has a timestamp label. GIF generation skipped (frames < 2 or --no-gif passed). Use `--individual-frames` to also save per-frame PNGs.");
                    return CommandResult.Ok(resultJson.ToString());
                }
                finally
                {
                    foreach (var tex in rendered)
                        if (tex != null) UnityEngine.Object.DestroyImmediate(tex);
                }
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

        // ── tiny bitmap font (5×7) for grid cell labels ────────────────────
        // Glyphs are 7 rows of 5-bit values, MSB = leftmost pixel. Encoded inline
        // so the addon stays self-contained; NOT a substitute for a real font system.
        // Used for rendering "t=0.50s" timestamp labels above each cell.
        static readonly Dictionary<char, byte[]> Glyphs = new Dictionary<char, byte[]>
        {
            { '0', new byte[] { 0x0E, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0E } },
            { '1', new byte[] { 0x04, 0x0C, 0x04, 0x04, 0x04, 0x04, 0x0E } },
            { '2', new byte[] { 0x0E, 0x11, 0x01, 0x02, 0x04, 0x08, 0x1F } },
            { '3', new byte[] { 0x1E, 0x01, 0x01, 0x0E, 0x01, 0x01, 0x1E } },
            { '4', new byte[] { 0x02, 0x06, 0x0A, 0x12, 0x1F, 0x02, 0x02 } },
            { '5', new byte[] { 0x1F, 0x10, 0x1E, 0x01, 0x01, 0x11, 0x0E } },
            { '6', new byte[] { 0x06, 0x08, 0x10, 0x1E, 0x11, 0x11, 0x0E } },
            { '7', new byte[] { 0x1F, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08 } },
            { '8', new byte[] { 0x0E, 0x11, 0x11, 0x0E, 0x11, 0x11, 0x0E } },
            { '9', new byte[] { 0x0E, 0x11, 0x11, 0x0F, 0x01, 0x02, 0x0C } },
            { '.', new byte[] { 0x00, 0x00, 0x00, 0x00, 0x00, 0x04, 0x04 } },
            { 's', new byte[] { 0x00, 0x00, 0x0F, 0x10, 0x0E, 0x01, 0x1E } },
            { 't', new byte[] { 0x08, 0x1E, 0x08, 0x08, 0x08, 0x09, 0x06 } },
            { '=', new byte[] { 0x00, 0x1F, 0x00, 0x1F, 0x00, 0x00, 0x00 } },
            { ' ', new byte[] { 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00 } },
            { '-', new byte[] { 0x00, 0x00, 0x00, 0x1F, 0x00, 0x00, 0x00 } },
        };

        const int GlyphW = 5;
        const int GlyphH = 7;
        const int GlyphScale = 2;          // 5×7 → 10×14 drawn
        const int GlyphAdvance = (GlyphW + 1) * GlyphScale;
        const int LabelTextH = GlyphH * GlyphScale;

        // Composes a (w, h + labelH) Texture2D with a "t=X.XXs" label strip across the top
        // and the source frame below it. Used for GIF frames so the animation displays its
        // own timestamp; the grid composite still uses the un-labelled `rendered[]` directly.
        static Texture2D BuildLabelledFrame(Texture2D source, float t, int w, int h, int labelH)
        {
            var dst = new Texture2D(w, h + labelH, TextureFormat.RGBA32, mipChain: false);
            // Copy source into bottom region. Texture2D origin = bottom-left, so source pixels
            // sit at y=[0, h) and the label strip occupies y=[h, h+labelH).
            dst.SetPixels(0, 0, w, h, source.GetPixels());
            DrawLabelStrip(dst, 0, h, w, labelH, $"t={t:F2}s");
            dst.Apply();
            return dst;
        }

        static void DrawLabelStrip(Texture2D tex, int x, int y, int w, int h, string text)
        {
            // Background: medium-dark grey so white text reads cleanly regardless of frame contents.
            var stripBg = new Color(0.15f, 0.15f, 0.18f, 1f);
            var fill = new Color[w * h];
            for (int p = 0; p < fill.Length; p++) fill[p] = stripBg;
            tex.SetPixels(x, y, w, h, fill);

            // Center the text horizontally + vertically within the strip.
            int textW = text.Length * GlyphAdvance;
            int tx = x + Mathf.Max(2, (w - textW) / 2);
            int ty = y + Mathf.Max(2, (h - LabelTextH) / 2);

            var ink = Color.white;
            foreach (var ch in text)
            {
                if (!Glyphs.TryGetValue(ch, out var glyph)) glyph = Glyphs[' '];
                DrawGlyph(tex, tx, ty, glyph, ink);
                tx += GlyphAdvance;
                if (tx + GlyphW * GlyphScale > x + w) break;  // clip rather than overflow.
            }
        }

        static void DrawGlyph(Texture2D tex, int x, int y, byte[] glyph, Color color)
        {
            // Texture origin = bottom-left. Glyph row 0 is the TOP visual row, so we paint top-down.
            for (int row = 0; row < GlyphH; row++)
            {
                byte bits = glyph[row];
                int py = y + (GlyphH - 1 - row) * GlyphScale;
                for (int col = 0; col < GlyphW; col++)
                {
                    bool on = (bits & (1 << (GlyphW - 1 - col))) != 0;
                    if (!on) continue;
                    int px = x + col * GlyphScale;
                    for (int dy = 0; dy < GlyphScale; dy++)
                        for (int dx = 0; dx < GlyphScale; dx++)
                            tex.SetPixel(px + dx, py + dy, color);
                }
            }
        }
    }
}
