using System;
using System.Collections.Generic;
using System.IO;
using UnityEditor;
using UnityEngine;
using Dreamer.AgentBridge;

namespace Dreamer.AgentBridge.FX
{
    /// <summary>
    /// setup-particle-material: ensure every ParticleSystemRenderer in a prefab has a
    /// material. Defaults to a placeholder (white tint, additive blend) using
    /// Particles/Standard Unlit when available, falling back through pipeline-specific
    /// equivalents to Sprites/Default. Closes the "particles invisible/magenta" gap on
    /// freshly-created particle prefabs.
    /// </summary>
    public static class ParticleMaterialOps
    {
        const string DefaultDir = "Assets/Materials";

        // Probed in order. First Shader.Find hit wins.
        static readonly string[] FallbackShaders = new[]
        {
            "Particles/Standard Unlit",
            "Universal Render Pipeline/Particles/Unlit",
            "HDRP/Particles/Lit",
            "Sprites/Default",
        };

        public static CommandResult SetupParticleMaterial(Dictionary<string, object> args)
        {
            string assetPath = AssetOps.ResolveAssetPath(args);
            if (assetPath == null)
                return CommandResult.Fail("Provide 'assetPath' or 'guid' (path to a prefab containing a ParticleSystem).");
            if (!assetPath.EndsWith(".prefab", StringComparison.OrdinalIgnoreCase))
                return CommandResult.Fail($"'{assetPath}' is not a .prefab.");

            string nameArg   = SimpleJson.GetString(args, "name");
            string pathArg   = SimpleJson.GetString(args, "path");
            string shaderArg = SimpleJson.GetString(args, "shader");
            string colorArg  = SimpleJson.GetString(args, "color");
            string texArg    = SimpleJson.GetString(args, "texture");
            string blendArg  = SimpleJson.GetString(args, "blendMode");
            bool force       = SimpleJson.GetBool(args, "force", false);

            string stem = Path.GetFileNameWithoutExtension(assetPath);
            string matName = string.IsNullOrEmpty(nameArg) ? stem + "_Particle" : nameArg;
            string matDir  = string.IsNullOrEmpty(pathArg) ? DefaultDir : pathArg.TrimEnd('/', '\\');
            string matPath = $"{matDir}/{matName}.mat";

            Color tint = Color.white;
            if (!string.IsNullOrEmpty(colorArg) && !TryParseHexColor(colorArg, out tint, out string colorErr))
                return CommandResult.Fail(colorErr);

            Texture mainTex = null;
            if (!string.IsNullOrEmpty(texArg))
            {
                mainTex = AssetDatabase.LoadAssetAtPath<Texture>(texArg);
                if (mainTex == null)
                    return CommandResult.Fail($"Texture '{texArg}' not found or not a Texture asset.");
            }

            var prefabRoot = PrefabUtility.LoadPrefabContents(assetPath);
            if (prefabRoot == null)
                return CommandResult.Fail($"Failed to load prefab: {assetPath}");

            bool createdMat = false;
            bool assignedAny = false;
            string finalShader = null;
            var rendererInfo = SimpleJson.Array();

            try
            {
                var renderers = prefabRoot.GetComponentsInChildren<ParticleSystemRenderer>(true);
                if (renderers.Length == 0)
                    return CommandResult.Fail($"No ParticleSystemRenderer found in '{assetPath}'.");

                // Walk renderers, decide whether we need a material.
                bool anyNeedsMaterial = false;
                foreach (var psr in renderers)
                {
                    bool hadMat = psr.sharedMaterial != null;
                    if (!hadMat || force) anyNeedsMaterial = true;
                }

                Material mat = null;
                if (anyNeedsMaterial)
                {
                    EnsureFolder(matDir);

                    mat = AssetDatabase.LoadAssetAtPath<Material>(matPath);
                    if (mat == null)
                    {
                        Shader shader = ResolveShader(shaderArg);
                        if (shader == null)
                            return CommandResult.Fail($"Could not find shader '{shaderArg ?? "(auto)"}'. Tried: {string.Join(", ", FallbackShaders)}");
                        mat = new Material(shader);
                        mat.name = matName;
                        ApplyMaterialDefaults(mat, tint, mainTex, blendArg);
                        AssetDatabase.CreateAsset(mat, matPath);
                        createdMat = true;
                        finalShader = shader.name;
                    }
                    else
                    {
                        // Reusing existing material — tint/texture/blend args are advisory only on reuse.
                        // The agent should call set-material-property to tweak in that case.
                        finalShader = mat.shader != null ? mat.shader.name : "(unknown)";
                    }
                }

                foreach (var psr in renderers)
                {
                    bool hadMat = psr.sharedMaterial != null;
                    bool willAssign = mat != null && (!hadMat || force);
                    if (willAssign)
                    {
                        psr.sharedMaterial = mat;
                        EditorUtility.SetDirty(psr);
                        assignedAny = true;
                    }
                    rendererInfo.AddRaw(SimpleJson.Object()
                        .Put("path", GetRelativePath(prefabRoot.transform, psr.transform))
                        .Put("hadMaterial", hadMat)
                        .Put("assigned", willAssign)
                        .ToString());
                }

                if (assignedAny)
                {
                    PrefabUtility.SaveAsPrefabAsset(prefabRoot, assetPath);
                }
            }
            finally
            {
                PrefabOps.SafeUnloadPrefabContents(prefabRoot);
            }

            if (createdMat) AssetDatabase.SaveAssets();

            string hint;
            if (assignedAny && createdMat)
                hint = "Created a placeholder material and assigned it. Capture-particle should now show visible particles. Use `set-material-property` to fine-tune color / texture / blend.";
            else if (assignedAny)
                hint = "Reused an existing material at the target path. If you need different defaults, pass `--name` to create a fresh one.";
            else
                hint = "No-op: every ParticleSystemRenderer already had a material. Pass `--force` to overwrite.";

            var resultJson = SimpleJson.Object()
                .Put("created", createdMat)
                .Put("assigned", assignedAny)
                .Put("materialPath", matPath)
                .Put("shader", finalShader ?? "")
                .PutRaw("renderers", rendererInfo.ToString())
                .Put("hint", hint);
            return CommandResult.Ok(resultJson.ToString());
        }

        // ── helpers ────────────────────────────────────────────────────────

        static Shader ResolveShader(string requested)
        {
            if (!string.IsNullOrEmpty(requested))
                return Shader.Find(requested);
            foreach (var s in FallbackShaders)
            {
                var sh = Shader.Find(s);
                if (sh != null) return sh;
            }
            return null;
        }

        static void ApplyMaterialDefaults(Material mat, Color tint, Texture tex, string blend)
        {
            // Color: try the standard slots in order. Particle shaders usually expose either
            // _TintColor (legacy Particles/*) or _BaseColor (URP) or _Color (Standard, Sprites).
            TrySetColor(mat, "_TintColor", tint);
            TrySetColor(mat, "_BaseColor", tint);
            TrySetColor(mat, "_Color", tint);

            if (tex != null)
            {
                if (mat.HasProperty("_MainTex")) mat.SetTexture("_MainTex", tex);
                if (mat.HasProperty("_BaseMap")) mat.SetTexture("_BaseMap", tex);
            }

            if (string.IsNullOrEmpty(blend)) blend = "additive";
            ApplyBlendMode(mat, blend);
        }

        static void TrySetColor(Material mat, string prop, Color c)
        {
            if (mat.HasProperty(prop)) mat.SetColor(prop, c);
        }

        // Particles/Standard Unlit exposes _Mode (Opaque=0, Cutout=1, Fade=2, Transparent=3,
        // Additive=4, Subtractive=5, Modulate=6). Setting _Mode alone isn't enough — Unity's
        // editor-only `MaterialEditor.SetupMaterialWithBlendMode` also flips render queue,
        // SrcBlend/DstBlend, and ZWrite. We replicate just enough of that here to make a
        // freshly-created material render correctly without opening the Inspector.
        static void ApplyBlendMode(Material mat, string blend)
        {
            string b = blend.ToLowerInvariant();
            if (mat.HasProperty("_Mode"))
            {
                switch (b)
                {
                    case "opaque":     SetBuiltinBlend(mat, mode: 0, src: 1, dst: 0,   zwrite: 1, queue: -1);   break;
                    case "alpha":      SetBuiltinBlend(mat, mode: 2, src: 5, dst: 10,  zwrite: 0, queue: 3000); break;
                    case "multiply":   SetBuiltinBlend(mat, mode: 6, src: 2, dst: 0,   zwrite: 0, queue: 3000); break;
                    case "additive":
                    default:           SetBuiltinBlend(mat, mode: 4, src: 5, dst: 1,   zwrite: 0, queue: 3000); break;
                }
            }
            else if (mat.HasProperty("_Surface"))
            {
                // URP Particles/Unlit: _Surface (0=Opaque, 1=Transparent), _Blend (0=Alpha, 1=Premultiply, 2=Additive, 3=Multiply).
                bool transparent = b != "opaque";
                int blendIdx = b == "additive" ? 2 : b == "multiply" ? 3 : 0;
                if (mat.HasProperty("_Surface")) mat.SetFloat("_Surface", transparent ? 1f : 0f);
                if (mat.HasProperty("_Blend"))   mat.SetFloat("_Blend", blendIdx);
                mat.renderQueue = transparent ? 3000 : -1;
            }
        }

        static void SetBuiltinBlend(Material mat, int mode, int src, int dst, int zwrite, int queue)
        {
            mat.SetFloat("_Mode", mode);
            if (mat.HasProperty("_SrcBlend"))  mat.SetFloat("_SrcBlend", src);
            if (mat.HasProperty("_DstBlend"))  mat.SetFloat("_DstBlend", dst);
            if (mat.HasProperty("_ZWrite"))    mat.SetFloat("_ZWrite", zwrite);
            mat.renderQueue = queue;
            // Keywords that the Particles/Standard Unlit shader checks.
            mat.DisableKeyword("_ALPHABLEND_ON");
            mat.DisableKeyword("_ALPHAPREMULTIPLY_ON");
            mat.DisableKeyword("_ALPHAMODULATE_ON");
            switch (mode)
            {
                case 2: mat.EnableKeyword("_ALPHABLEND_ON"); break;
                case 3: mat.EnableKeyword("_ALPHAPREMULTIPLY_ON"); break;
                case 6: mat.EnableKeyword("_ALPHAMODULATE_ON"); break;
            }
        }

        static bool TryParseHexColor(string raw, out Color color, out string error)
        {
            color = Color.white;
            error = null;
            string s = raw.StartsWith("#") ? raw.Substring(1) : raw;
            if (s.Length == 6) s += "FF";
            if (s.Length != 8) { error = $"color: expected '#RRGGBB' or '#RRGGBBAA', got '{raw}'."; return false; }
            if (!uint.TryParse(s, System.Globalization.NumberStyles.HexNumber, System.Globalization.CultureInfo.InvariantCulture, out uint rgba))
            { error = $"color: invalid hex '{raw}'."; return false; }
            color = new Color(((rgba >> 24) & 0xFF) / 255f, ((rgba >> 16) & 0xFF) / 255f, ((rgba >> 8) & 0xFF) / 255f, (rgba & 0xFF) / 255f);
            return true;
        }

        static void EnsureFolder(string dir)
        {
            if (AssetDatabase.IsValidFolder(dir)) return;
            // Walk up creating segments.
            var segments = dir.Split('/');
            string acc = segments[0]; // typically "Assets"
            for (int i = 1; i < segments.Length; i++)
            {
                string next = $"{acc}/{segments[i]}";
                if (!AssetDatabase.IsValidFolder(next))
                    AssetDatabase.CreateFolder(acc, segments[i]);
                acc = next;
            }
        }

        static string GetRelativePath(Transform root, Transform t)
        {
            if (t == root) return "";
            var stack = new Stack<string>();
            for (var cur = t; cur != null && cur != root; cur = cur.parent)
                stack.Push(cur.name);
            return string.Join("/", stack);
        }
    }
}
