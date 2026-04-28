using System;
using System.Collections.Generic;
using System.IO;
using UnityEditor;
using UnityEngine;

namespace Dreamer.AgentBridge
{
    /// <summary>
    /// Visual feedback for agents — render Unity assets to PNG so Claude can
    /// "see" what it's building. PreviewRenderUtility handles the off-screen
    /// scene/camera/lights setup; we frame the camera on the prefab's
    /// combined renderer bounds for an automatic best-effort thumbnail.
    /// </summary>
    public static class PreviewOps
    {
        const string DefaultDir = "Library/DreamerScreenshots";

        public static CommandResult ScreenshotPrefab(Dictionary<string, object> args)
        {
            string assetPath = AssetOps.ResolveAssetPath(args);
            if (assetPath == null)
                return CommandResult.Fail("Provide 'assetPath' or 'guid' (path to a prefab).");
            if (!assetPath.EndsWith(".prefab", StringComparison.OrdinalIgnoreCase))
                return CommandResult.Fail($"'{assetPath}' is not a .prefab. screenshot-prefab only handles GameObject prefabs; use a future preview-asset for materials/sprites.");

            int width = SimpleJson.GetInt(args, "width", 512);
            int height = SimpleJson.GetInt(args, "height", 512);
            if (width <= 0 || height <= 0)
                return CommandResult.Fail("'width' and 'height' must be positive.");
            if (width > 4096 || height > 4096)
                return CommandResult.Fail("'width' and 'height' max 4096.");

            string savePath = SimpleJson.GetString(args, "savePath");
            string angle = SimpleJson.GetString(args, "angle") ?? "iso";
            bool transparent = SimpleJson.GetBool(args, "transparent", false);
            Color background;
            if (transparent)
            {
                background = new Color(0f, 0f, 0f, 0f);
            }
            else if (args.TryGetValue("backgroundColor", out object bgObj))
            {
                if (!TryParseColor(bgObj, out background, out string colorErr))
                    return CommandResult.Fail(colorErr);
            }
            else
            {
                background = new Color(0.32f, 0.32f, 0.36f, 1f);
            }

            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(assetPath);
            if (prefab == null)
                return CommandResult.Fail($"Failed to load prefab at '{assetPath}'.");

            PreviewRenderUtility pru = null;
            GameObject instance = null;
            try
            {
                pru = new PreviewRenderUtility();

                pru.camera.clearFlags = CameraClearFlags.SolidColor;
                pru.camera.backgroundColor = background;
                // Transparent backgrounds need the camera to use a render
                // target with an alpha channel — PreviewRenderUtility's
                // internal RT is ARGB32 by default, so EncodeToPNG below
                // preserves alpha. If the resulting PNG is opaque despite
                // alpha=0, the platform's preview RT format isn't ARGB32
                // and we'd need a custom RT (not done here yet).
                pru.camera.allowHDR = false;
                pru.camera.fieldOfView = 30f;
                pru.camera.nearClipPlane = 0.05f;
                pru.camera.farClipPlane = 5000f;

                // Two-light rim setup — key from upper-front, fill from lower-back.
                if (pru.lights != null && pru.lights.Length >= 2)
                {
                    pru.lights[0].intensity = 1.2f;
                    pru.lights[0].transform.rotation = Quaternion.Euler(35f, 35f, 0f);
                    pru.lights[1].intensity = 0.55f;
                    pru.lights[1].transform.rotation = Quaternion.Euler(-25f, -160f, 0f);
                }
                pru.ambientColor = new Color(0.28f, 0.28f, 0.32f);

                // Spawn the prefab into PRU's preview scene.
                instance = UnityEngine.Object.Instantiate(prefab);
                instance.hideFlags = HideFlags.HideAndDontSave;
                pru.AddSingleGO(instance);

                // Frame the camera on combined renderer bounds.
                Bounds bounds = ComputeBounds(instance);
                Vector3 dirLocal = AngleToCameraDir(angle);
                float radius = Mathf.Max(bounds.extents.magnitude, 0.5f);
                float distance = radius / Mathf.Sin(pru.camera.fieldOfView * 0.5f * Mathf.Deg2Rad);
                pru.camera.transform.position = bounds.center + dirLocal.normalized * distance * 1.35f;
                pru.camera.transform.LookAt(bounds.center);

                // Render off-screen → Texture2D. Use a custom ARGB32 RT instead
                // of PreviewRenderUtility.BeginStaticPreview / EndStaticPreview:
                // the latter allocates an RGB-only RT internally, so an alpha=0
                // background would silently come back as solid black. Using our
                // own ARGB32 RT preserves the alpha channel through to PNG.
                var rt = RenderTexture.GetTemporary(width, height, 24, RenderTextureFormat.ARGB32);
                rt.Create();
                var prevTarget = pru.camera.targetTexture;
                var prevActive = RenderTexture.active;
                Texture2D rendered;
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
                    return CommandResult.Fail("Render returned null. Likely cause: graphics device unavailable (headless/batch mode without -nographics workaround), or Unity is unfocused on a platform that throttles render.");

                byte[] png = rendered.EncodeToPNG();
                UnityEngine.Object.DestroyImmediate(rendered);

                if (string.IsNullOrEmpty(savePath))
                {
                    Directory.CreateDirectory(DefaultDir);
                    string assetGuid = AssetDatabase.AssetPathToGUID(assetPath);
                    string stem = Path.GetFileNameWithoutExtension(assetPath);
                    savePath = Path.Combine(DefaultDir, $"{stem}-{assetGuid.Substring(0, 8)}-{DateTime.UtcNow.Ticks}.png").Replace('\\', '/');
                }
                else
                {
                    string parent = Path.GetDirectoryName(savePath);
                    if (!string.IsNullOrEmpty(parent)) Directory.CreateDirectory(parent);
                }

                File.WriteAllBytes(savePath, png);

                return CommandResult.Ok(SimpleJson.Object()
                    .Put("asset", assetPath)
                    .Put("path", savePath)
                    .Put("width", width)
                    .Put("height", height)
                    .Put("byteCount", png.Length)
                    .Put("angle", angle)
                    .PutRaw("boundsCenter", $"[{bounds.center.x},{bounds.center.y},{bounds.center.z}]")
                    .PutRaw("boundsSize", $"[{bounds.size.x},{bounds.size.y},{bounds.size.z}]")
                    .Put("hint", "Open the PNG with the Read tool to view the rendered prefab.")
                    .ToString());
            }
            catch (Exception ex)
            {
                return CommandResult.Fail($"Screenshot failed: {ex.GetType().Name}: {ex.Message}");
            }
            finally
            {
                if (instance != null) UnityEngine.Object.DestroyImmediate(instance);
                if (pru != null) pru.Cleanup();
            }
        }

        // ── Helpers ───────────────────────────────────────────────────────

        static Bounds ComputeBounds(GameObject root)
        {
            // Compute from mesh data, NOT from Renderer.bounds. Renderer.bounds
            // is initialized lazily by the rendering pipeline and comes back
            // (0,0,0) for objects in a PreviewScene that haven't been rendered
            // yet — which is exactly our case (we compute bounds before the
            // first Render() to know where to place the camera).
            Bounds? combined = null;

            foreach (var mf in root.GetComponentsInChildren<MeshFilter>(includeInactive: true))
            {
                if (mf == null || mf.sharedMesh == null) continue;
                var w = TransformBounds(mf.sharedMesh.bounds, mf.transform.localToWorldMatrix);
                combined = combined.HasValue ? Encapsulate(combined.Value, w) : w;
            }

            foreach (var smr in root.GetComponentsInChildren<SkinnedMeshRenderer>(includeInactive: true))
            {
                if (smr == null || smr.sharedMesh == null) continue;
                // SkinnedMeshRenderer.localBounds is the asset's bind-pose extent.
                var w = TransformBounds(smr.localBounds, smr.transform.localToWorldMatrix);
                combined = combined.HasValue ? Encapsulate(combined.Value, w) : w;
            }

            foreach (var sr in root.GetComponentsInChildren<SpriteRenderer>(includeInactive: true))
            {
                if (sr == null || sr.sprite == null) continue;
                var w = TransformBounds(sr.sprite.bounds, sr.transform.localToWorldMatrix);
                combined = combined.HasValue ? Encapsulate(combined.Value, w) : w;
            }

            // ParticleSystemRenderer / TrailRenderer / LineRenderer rarely have
            // a useful pre-render extent — skip them; their bounds are dynamic.

            if (combined.HasValue && combined.Value.size != Vector3.zero)
                return combined.Value;

            // No mesh-bearing renderers — union child transforms as a coarse
            // proxy (works for empty containers, lights-only prefabs, etc).
            var transforms = root.GetComponentsInChildren<Transform>(includeInactive: true);
            Bounds tb = new Bounds(root.transform.position, Vector3.one);
            foreach (var t in transforms) tb.Encapsulate(t.position);
            return tb;
        }

        static Bounds TransformBounds(Bounds local, Matrix4x4 m)
        {
            // AABB transform: new extents pick up rotation/scale via |m_ij| sums.
            var center = m.MultiplyPoint3x4(local.center);
            var ext = local.extents;
            var newExt = new Vector3(
                Mathf.Abs(m.m00) * ext.x + Mathf.Abs(m.m01) * ext.y + Mathf.Abs(m.m02) * ext.z,
                Mathf.Abs(m.m10) * ext.x + Mathf.Abs(m.m11) * ext.y + Mathf.Abs(m.m12) * ext.z,
                Mathf.Abs(m.m20) * ext.x + Mathf.Abs(m.m21) * ext.y + Mathf.Abs(m.m22) * ext.z
            );
            return new Bounds(center, newExt * 2f);
        }

        static Bounds Encapsulate(Bounds a, Bounds b) { a.Encapsulate(b); return a; }

        static bool TryParseColor(object raw, out Color color, out string error)
        {
            color = Color.black;
            error = null;
            if (raw is string s)
            {
                s = s.Trim();
                if (s.StartsWith("#")) s = s.Substring(1);
                if (s.Length == 6 || s.Length == 8)
                {
                    try
                    {
                        byte r = Convert.ToByte(s.Substring(0, 2), 16);
                        byte g = Convert.ToByte(s.Substring(2, 2), 16);
                        byte b = Convert.ToByte(s.Substring(4, 2), 16);
                        byte a = (s.Length == 8) ? Convert.ToByte(s.Substring(6, 2), 16) : (byte)255;
                        color = new Color32(r, g, b, a);
                        return true;
                    }
                    catch (Exception ex)
                    {
                        error = $"Hex color parse failed: {ex.Message}";
                        return false;
                    }
                }
                error = $"Hex color must be #RRGGBB or #RRGGBBAA; got '{s}'.";
                return false;
            }
            if (raw is List<object> arr && (arr.Count == 3 || arr.Count == 4))
            {
                color = new Color(
                    ToFloat(arr[0]),
                    ToFloat(arr[1]),
                    ToFloat(arr[2]),
                    arr.Count == 4 ? ToFloat(arr[3]) : 1f);
                return true;
            }
            error = "backgroundColor must be a hex string (#RRGGBB or #RRGGBBAA) or an RGB(A) array of 0..1 floats.";
            return false;
        }

        static float ToFloat(object o)
        {
            if (o is double d) return (float)d;
            if (o is float f) return f;
            if (o is long l) return l;
            if (o is int i) return i;
            return 0f;
        }

        static Vector3 AngleToCameraDir(string angle)
        {
            switch ((angle ?? "iso").Trim().ToLowerInvariant())
            {
                case "front":   return Quaternion.Euler(0f, 0f, 0f) * Vector3.back;
                case "back":    return Quaternion.Euler(0f, 180f, 0f) * Vector3.back;
                case "side":
                case "right":   return Quaternion.Euler(0f, 90f, 0f) * Vector3.back;
                case "left":    return Quaternion.Euler(0f, -90f, 0f) * Vector3.back;
                case "top":     return Quaternion.Euler(89f, 0f, 0f) * Vector3.back;
                case "bottom":  return Quaternion.Euler(-89f, 0f, 0f) * Vector3.back;
                case "iso":
                default:        return Quaternion.Euler(20f, -30f, 0f) * Vector3.back;
            }
        }
    }
}
