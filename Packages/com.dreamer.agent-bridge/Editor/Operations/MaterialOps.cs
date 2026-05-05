using System;
using System.Collections.Generic;
using System.IO;
using UnityEditor;
using UnityEngine;

namespace Dreamer.AgentBridge
{
    /// <summary>Material operations. Materials use the non-SerializedProperty MaterialProperty API (SetColor/SetFloat/SetTexture/...) so the generic set-property path doesn't reach them.</summary>
    public static class MaterialOps
    {
        // ── create-material ──────────────────────────────────────────────

        /// <summary>Create a new material asset. Args: { name, path?, shader? }</summary>
        public static CommandResult CreateMaterial(Dictionary<string, object> args)
        {
            string name = SimpleJson.GetString(args, "name");
            if (string.IsNullOrEmpty(name))
                return CommandResult.Fail("'name' is required.");

            string folder = SimpleJson.GetString(args, "path", "Assets/Materials");
            string shaderName = SimpleJson.GetString(args, "shader");

            // Default to Standard; URP/HDRP projects should pass --shader explicitly. Caller
            // gets a warning in the result either way so they can see what was picked.
            Shader shader = null;
            string shaderPickWarning = null;
            if (!string.IsNullOrEmpty(shaderName))
            {
                shader = Shader.Find(shaderName);
                if (shader == null)
                    return CommandResult.Fail($"Shader '{shaderName}' not found. Use `./bin/dreamer inspect-shader` or Shader.Find('...') to verify the name.");
            }
            else
            {
                shader = Shader.Find("Standard") ?? Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("HDRP/Lit");
                if (shader == null)
                    return CommandResult.Fail("No fallback shader found (tried Standard, URP/Lit, HDRP/Lit). Pass `--shader 'Shader/Name'` explicitly.");
                shaderPickWarning = $"No shader specified — defaulted to '{shader.name}'. Pass `--shader` explicitly if you want a different one.";
            }

            string fullDir = Path.GetFullPath(folder);
            if (!Directory.Exists(fullDir))
            {
                Directory.CreateDirectory(fullDir);
                AssetDatabase.Refresh();
            }

            string assetPath = $"{folder}/{name}.mat";
            if (File.Exists(Path.GetFullPath(assetPath)))
                return CommandResult.Fail($"Material already exists at: {assetPath}");

            var mat = new Material(shader);
            AssetDatabase.CreateAsset(mat, assetPath);
            AssetDatabase.SaveAssets();

            string guid = AssetDatabase.AssetPathToGUID(assetPath);
            var json = SimpleJson.Object()
                .Put("created", true)
                .Put("path", assetPath)
                .Put("guid", guid)
                .Put("shader", shader.name);
            if (shaderPickWarning != null) json.Put("warning", shaderPickWarning);
            return CommandResult.Ok(json.ToString());
        }

        // ── inspect-material ─────────────────────────────────────────────

        /// <summary>Return shader + property list so the agent knows what it can set without guessing. Pair with set-material-property. Args: { assetPath?, guid? }</summary>
        public static CommandResult InspectMaterial(Dictionary<string, object> args)
        {
            string assetPath = AssetOps.ResolveAssetPath(args);
            if (assetPath == null)
                return CommandResult.Fail("Material not found. Provide 'assetPath' or 'guid'.");

            var mat = AssetDatabase.LoadMainAssetAtPath(assetPath) as Material;
            if (mat == null)
                return CommandResult.Fail($"Asset at '{assetPath}' is not a Material.");

            var shader = mat.shader;
            var props = SimpleJson.Array();

            int count = ShaderUtil.GetPropertyCount(shader);
            for (int i = 0; i < count; i++)
            {
                string pname = ShaderUtil.GetPropertyName(shader, i);
                string display = ShaderUtil.GetPropertyDescription(shader, i);
                var kind = ShaderUtil.GetPropertyType(shader, i);

                var p = SimpleJson.Object()
                    .Put("name", pname)
                    .Put("displayName", display)
                    .Put("type", kind.ToString());

                switch (kind)
                {
                    case ShaderUtil.ShaderPropertyType.Color:
                        var c = mat.GetColor(pname);
                        p.PutRaw("value", ColorJson(c));
                        break;
                    case ShaderUtil.ShaderPropertyType.Vector:
                        var v = mat.GetVector(pname);
                        p.PutRaw("value", Vector4Json(v));
                        break;
                    case ShaderUtil.ShaderPropertyType.Float:
                    case ShaderUtil.ShaderPropertyType.Range:
                        p.Put("value", mat.GetFloat(pname));
                        if (kind == ShaderUtil.ShaderPropertyType.Range)
                        {
                            float min = ShaderUtil.GetRangeLimits(shader, i, 1);
                            float max = ShaderUtil.GetRangeLimits(shader, i, 2);
                            p.Put("rangeMin", min).Put("rangeMax", max);
                        }
                        break;
                    case ShaderUtil.ShaderPropertyType.TexEnv:
                        var tex = mat.GetTexture(pname);
                        // Bare `null` in Put() is ambiguous between string and string[] overloads (CS0121).
                        string texPath = tex != null ? AssetDatabase.GetAssetPath(tex) : null;
                        if (texPath != null) p.Put("value", texPath);
                        else p.PutNull("value");
                        p.PutRaw("scale", Vector2Json(mat.GetTextureScale(pname)));
                        p.PutRaw("offset", Vector2Json(mat.GetTextureOffset(pname)));
                        break;
                    default:
                        p.PutNull("value");
                        break;
                }

                props.AddRaw(p.ToString());
            }

            var keywords = SimpleJson.Array();
            foreach (var kw in mat.shaderKeywords) keywords.Add(kw);

            var json = SimpleJson.Object()
                .Put("assetPath", assetPath)
                .Put("guid", AssetDatabase.AssetPathToGUID(assetPath))
                .Put("shader", shader.name)
                .Put("renderQueue", mat.renderQueue)
                .PutRaw("properties", props.ToString())
                .PutRaw("keywords", keywords.ToString())
                .ToString();
            return CommandResult.Ok(json);
        }

        // ── set-material-property ────────────────────────────────────────

        /// <summary>Set a material property via the MaterialProperty API (not SerializedObject). Args: { assetPath?, guid?, property, value } or { keyword, enable }. Value: Color {r,g,b,a} | Vector {x,y,z,w} | float | Texture {assetRef} or null.</summary>
        public static CommandResult SetMaterialProperty(Dictionary<string, object> args)
        {
            string assetPath = AssetOps.ResolveAssetPath(args);
            if (assetPath == null)
                return CommandResult.Fail("Material not found. Provide 'assetPath' or 'guid'.");

            var mat = AssetDatabase.LoadMainAssetAtPath(assetPath) as Material;
            if (mat == null)
                return CommandResult.Fail($"Asset at '{assetPath}' is not a Material.");

            string keyword = SimpleJson.GetString(args, "keyword");
            if (!string.IsNullOrEmpty(keyword))
            {
                bool enable = SimpleJson.GetBool(args, "enable", true);
                if (enable) mat.EnableKeyword(keyword);
                else mat.DisableKeyword(keyword);
                EditorUtility.SetDirty(mat);
                AssetDatabase.SaveAssets();
                return CommandResult.Ok(SimpleJson.Object()
                    .Put("set", true)
                    .Put("keyword", keyword)
                    .Put("enabled", enable)
                    .Put("assetPath", assetPath)
                    .ToString());
            }

            string property = SimpleJson.GetString(args, "property");
            if (string.IsNullOrEmpty(property))
                return CommandResult.Fail("'property' or 'keyword' is required.");

            if (!mat.HasProperty(property))
                return CommandResult.Fail($"Material '{mat.name}' (shader '{mat.shader.name}') has no property '{property}'. Run `./bin/dreamer inspect-material --asset {assetPath}` to see the real property names.");

            object value = SimpleJson.GetValue(args, "value");

            // Route by the shader's declared type so the caller doesn't need to pick the
            // right Set* method — this is the main reason to use this command over generic set-property.
            int propIdx = mat.shader.FindPropertyIndex(property);
            if (propIdx < 0)
                return CommandResult.Fail($"Shader '{mat.shader.name}' has no property index for '{property}' (likely an inherited/fallback-only property — this material can't set it).");

            var kind = mat.shader.GetPropertyType(propIdx);
            string err = null;
            switch (kind)
            {
                case UnityEngine.Rendering.ShaderPropertyType.Color:
                    err = SetColor(mat, property, value);
                    break;
                case UnityEngine.Rendering.ShaderPropertyType.Vector:
                    err = SetVector(mat, property, value);
                    break;
                case UnityEngine.Rendering.ShaderPropertyType.Float:
                case UnityEngine.Rendering.ShaderPropertyType.Range:
                    err = SetFloatValue(mat, property, value);
                    break;
                case UnityEngine.Rendering.ShaderPropertyType.Int:
                    err = SetIntValue(mat, property, value);
                    break;
                case UnityEngine.Rendering.ShaderPropertyType.Texture:
                    err = SetTexture(mat, property, value);
                    break;
                default:
                    err = $"Unsupported shader property kind: {kind}";
                    break;
            }

            if (err != null) return CommandResult.Fail(err);

            EditorUtility.SetDirty(mat);
            AssetDatabase.SaveAssets();

            return CommandResult.Ok(SimpleJson.Object()
                .Put("set", true)
                .Put("assetPath", assetPath)
                .Put("property", property)
                .Put("propertyType", kind.ToString())
                .ToString());
        }

        // ── set-material-shader ──────────────────────────────────────────

        /// <summary>Reassign a material's shader. Unity preserves compatible properties (same name + compatible type) and silently drops the rest. Args: { assetPath?, guid?, shader }</summary>
        public static CommandResult SetMaterialShader(Dictionary<string, object> args)
        {
            string assetPath = AssetOps.ResolveAssetPath(args);
            if (assetPath == null)
                return CommandResult.Fail("Material not found. Provide 'assetPath' or 'guid'.");

            var mat = AssetDatabase.LoadMainAssetAtPath(assetPath) as Material;
            if (mat == null)
                return CommandResult.Fail($"Asset at '{assetPath}' is not a Material.");

            string shaderName = SimpleJson.GetString(args, "shader");
            if (string.IsNullOrEmpty(shaderName))
                return CommandResult.Fail("'shader' is required (e.g. 'Universal Render Pipeline/Lit').");

            var newShader = Shader.Find(shaderName);
            if (newShader == null)
                return CommandResult.Fail($"Shader '{shaderName}' not found.");

            string previousShader = mat.shader != null ? mat.shader.name : null;
            mat.shader = newShader;
            EditorUtility.SetDirty(mat);
            AssetDatabase.SaveAssets();

            return CommandResult.Ok(SimpleJson.Object()
                .Put("set", true)
                .Put("assetPath", assetPath)
                .Put("shader", newShader.name)
                .Put("previousShader", previousShader)
                .ToString());
        }

        // ── Value-setter helpers ─────────────────────────────────────────

        static string SetColor(Material mat, string prop, object value)
        {
            var dict = value as Dictionary<string, object>;
            if (dict == null) return "Color expects {\"r\":..,\"g\":..,\"b\":..,\"a\":..}";
            var c = new Color(
                ToFloat(dict, "r", 0f), ToFloat(dict, "g", 0f),
                ToFloat(dict, "b", 0f), ToFloat(dict, "a", 1f));
            mat.SetColor(prop, c);
            return null;
        }

        static string SetVector(Material mat, string prop, object value)
        {
            var dict = value as Dictionary<string, object>;
            if (dict == null) return "Vector expects {\"x\":..,\"y\":..,\"z\":..,\"w\":..}";
            var v = new Vector4(
                ToFloat(dict, "x", 0f), ToFloat(dict, "y", 0f),
                ToFloat(dict, "z", 0f), ToFloat(dict, "w", 0f));
            mat.SetVector(prop, v);
            return null;
        }

        static string SetFloatValue(Material mat, string prop, object value)
        {
            float f;
            if (value is double d) f = (float)d;
            else if (value is float ff) f = ff;
            else if (value is int i) f = i;
            else if (value is long l) f = l;
            else if (value is string s && float.TryParse(s, System.Globalization.NumberStyles.Float,
                System.Globalization.CultureInfo.InvariantCulture, out float parsed)) f = parsed;
            else return "Float property expects a number or numeric string.";
            mat.SetFloat(prop, f);
            return null;
        }

        static string SetIntValue(Material mat, string prop, object value)
        {
            int n;
            if (value is int i) n = i;
            else if (value is long l) n = (int)l;
            else if (value is double d) n = (int)d;
            else if (value is string s && int.TryParse(s, out int parsed)) n = parsed;
            else return "Int property expects an integer or integer string.";
            mat.SetInt(prop, n);
            return null;
        }

        static string SetTexture(Material mat, string prop, object value)
        {
            if (value == null)
            {
                mat.SetTexture(prop, null);
                return null;
            }
            string path = null;
            if (value is string s) path = s;
            else if (value is Dictionary<string, object> dict)
                path = SimpleJson.GetString(dict, "assetRef");

            if (string.IsNullOrEmpty(path))
                return "Texture expects null (clear), a string asset path, or {\"assetRef\":\"Assets/...\"}.";

            var tex = AssetDatabase.LoadAssetAtPath<Texture>(path);
            if (tex == null) return $"Texture asset not found at: {path}";
            mat.SetTexture(prop, tex);
            return null;
        }

        static float ToFloat(Dictionary<string, object> dict, string key, float fallback)
        {
            if (!dict.TryGetValue(key, out object val)) return fallback;
            if (val is double d) return (float)d;
            if (val is float f) return f;
            if (val is int i) return i;
            if (val is long l) return l;
            if (val is string s && float.TryParse(s, System.Globalization.NumberStyles.Float,
                System.Globalization.CultureInfo.InvariantCulture, out float parsed)) return parsed;
            return fallback;
        }

        // ── JSON-fragment helpers ────────────────────────────────────────

        static string ColorJson(Color c) =>
            SimpleJson.Object().Put("r", c.r).Put("g", c.g).Put("b", c.b).Put("a", c.a).ToString();

        static string Vector2Json(Vector2 v) =>
            SimpleJson.Object().Put("x", v.x).Put("y", v.y).ToString();

        static string Vector4Json(Vector4 v) =>
            SimpleJson.Object().Put("x", v.x).Put("y", v.y).Put("z", v.z).Put("w", v.w).ToString();
    }
}
