using System;
using System.Collections.Generic;
using UnityEditor;
using UnityEngine;

namespace Dreamer.AgentBridge
{
    /// <summary>ParticleSystem property writer. Needed because PS config is exposed via C# wrapper structs (MainModule, ...) that proxy to native code, so generic set-property can't reach them. Also serialized field names don't match the API: main → InitialModule, limitVelocityOverLifetime → ClampVelocityModule, etc.</summary>
    // Two things this handler does the generic resolver can't:
    //   1. Rewrite API-style first segments to their serialized equivalents (see ModuleAlias).
    //   2. Expand a bare scalar to MinMaxCurve.scalar + minMaxState=0 for MinMaxCurve structs
    //      (covers startLifetime, startSpeed, rateOverTime, most numeric module fields).
    public static class ParticleOps
    {
        // C# API name → SerializedProperty name; verified against Unity's serialization layout.
        static readonly Dictionary<string, string> ModuleAlias = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            { "main",                       "InitialModule"            },
            { "emission",                   "EmissionModule"           },
            { "shape",                      "ShapeModule"              },
            { "velocityOverLifetime",       "VelocityModule"           },
            { "limitVelocityOverLifetime",  "ClampVelocityModule"      },
            { "inheritVelocity",            "InheritVelocityModule"    },
            { "lifetimeByEmitterSpeed",     "LifetimeByEmitterSpeedModule" },
            { "forceOverLifetime",          "ForceModule"              },
            { "colorOverLifetime",          "ColorModule"              },
            { "colorBySpeed",               "ColorBySpeedModule"       },
            { "sizeOverLifetime",           "SizeModule"               },
            { "sizeBySpeed",                "SizeBySpeedModule"        },
            { "rotationOverLifetime",       "RotationModule"           },
            { "rotationBySpeed",            "RotationBySpeedModule"    },
            { "externalForces",             "ExternalForcesModule"     },
            { "noise",                      "NoiseModule"              },
            { "collision",                  "CollisionModule"          },
            { "trigger",                    "TriggerModule"            },
            { "subEmitters",                "SubModule"                },
            { "textureSheetAnimation",      "UVModule"                 },
            { "lights",                     "LightsModule"             },
            { "trails",                     "TrailModule"              },
            { "customData",                 "CustomDataModule"         },
        };

        public static CommandResult SetParticleProperty(Dictionary<string, object> args)
        {
            string propertyPath = SimpleJson.GetString(args, "propertyPath");
            if (string.IsNullOrEmpty(propertyPath))
                return CommandResult.Fail("'propertyPath' is required.");

            object value = SimpleJson.GetValue(args, "value");

            ParticleSystem ps = ResolveParticleSystem(args, out string error, out UnityEngine.Object dirtyTarget, out string targetDescription, out string assetPath);
            if (ps == null)
                return CommandResult.Fail(error);

            string serializedPath = RewriteModulePath(propertyPath, out string moduleApiName, out string moduleSerializedName);

            var so = new SerializedObject(ps);
            var sp = so.FindProperty(serializedPath);
            if (sp == null)
            {
                string hint = moduleApiName != null
                    ? $" (rewrote '{moduleApiName}' → '{moduleSerializedName}'; tried '{serializedPath}'). Modules known: {string.Join(", ", ModuleAlias.Keys)}."
                    : $" (Path tried verbatim. Did you mean a module path like 'main.startLifetime' or 'emission.rateOverTime'?)";
                return CommandResult.Fail($"ParticleSystem property '{propertyPath}' didn't resolve.{hint}");
            }

            string applyError = ApplyParticleValue(sp, value);
            if (applyError != null) return CommandResult.Fail(applyError);

            so.ApplyModifiedPropertiesWithoutUndo();
            EditorUtility.SetDirty(dirtyTarget);
            if (!string.IsNullOrEmpty(assetPath)) AssetDatabase.SaveAssets();

            var json = SimpleJson.Object()
                .Put("set", true)
                .Put("propertyPath", propertyPath)
                .Put("resolvedPath", serializedPath)
                .Put("componentType", "UnityEngine.ParticleSystem")
                .Put("target", targetDescription);
            if (!string.IsNullOrEmpty(assetPath)) json.Put("assetPath", assetPath);

            return CommandResult.Ok(json.ToString());
        }

        // ── Target resolution ──

        static ParticleSystem ResolveParticleSystem(Dictionary<string, object> args, out string error, out UnityEngine.Object dirtyTarget, out string targetDescription, out string assetPath)
        {
            error = null;
            dirtyTarget = null;
            targetDescription = null;
            assetPath = null;

            string sceneObjectPath = SimpleJson.GetString(args, "sceneObjectPath");
            if (!string.IsNullOrEmpty(sceneObjectPath))
            {
                var go = PropertyOps.FindSceneObject(sceneObjectPath, out string findErr);
                if (go == null) { error = findErr ?? $"Scene object not found: {sceneObjectPath}"; return null; }
                var ps = go.GetComponent<ParticleSystem>();
                if (ps == null) { error = $"No ParticleSystem on '{sceneObjectPath}'."; return null; }
                dirtyTarget = go;
                targetDescription = sceneObjectPath;
                return ps;
            }

            string ap = AssetOps.ResolveAssetPath(args);
            if (string.IsNullOrEmpty(ap))
            {
                error = "Target not found. Provide --scene-object PATH, or --asset PATH (--child-path SUBPATH).";
                return null;
            }
            assetPath = ap;

            var prefabAsset = AssetDatabase.LoadMainAssetAtPath(ap) as GameObject;
            if (prefabAsset == null) { error = $"Failed to load prefab: {ap}"; return null; }

            string childPath = SimpleJson.GetString(args, "childPath");
            GameObject host = prefabAsset;
            if (!string.IsNullOrEmpty(childPath))
            {
                Transform child = prefabAsset.transform.Find(childPath);
                if (child == null) { error = $"Child '{childPath}' not found in prefab '{ap}'."; return null; }
                host = child.gameObject;
            }

            var ps2 = host.GetComponent<ParticleSystem>();
            if (ps2 == null)
            {
                error = string.IsNullOrEmpty(childPath)
                    ? $"No ParticleSystem on prefab root '{ap}' (try --child-path)."
                    : $"No ParticleSystem on '{ap}' child '{childPath}'.";
                return null;
            }
            dirtyTarget = prefabAsset;
            targetDescription = string.IsNullOrEmpty(childPath) ? ap : $"{ap}:{childPath}";
            return ps2;
        }

        // ── Path rewrite ──

        // "main.startLifetime" → "InitialModule.startLifetime"; bare paths pass through unchanged.
        static string RewriteModulePath(string path, out string apiName, out string serializedName)
        {
            apiName = null;
            serializedName = null;
            int dot = path.IndexOf('.');
            string firstSeg = dot < 0 ? path : path.Substring(0, dot);
            string rest = dot < 0 ? "" : path.Substring(dot);
            if (ModuleAlias.TryGetValue(firstSeg, out string mapped))
            {
                apiName = firstSeg;
                serializedName = mapped;
                return mapped + rest;
            }
            return path;
        }

        // ── Value application ──

        static string ApplyParticleValue(SerializedProperty sp, object value)
        {
            // MinMaxCurve struct detection via presence of "minMaxState" child.
            // Bare scalar → mode=Constant; {min,max} → mode=TwoConstants.
            if (sp.propertyType == SerializedPropertyType.Generic)
            {
                var stateProp = sp.FindPropertyRelative("minMaxState");
                if (stateProp != null)
                {
                    if (TryAsScalar(value, out float scalar))
                    {
                        SetMinMaxCurveConstant(sp, stateProp, scalar);
                        return null;
                    }
                    if (TryAsMinMaxObject(value, out float min, out float max))
                    {
                        SetMinMaxCurveTwoConstants(sp, stateProp, min, max);
                        return null;
                    }
                    return $"MinMaxCurve at '{sp.propertyPath}' takes a scalar (constant) or {{min, max}} (two constants). For curves, set sub-fields explicitly: '{sp.propertyPath.Replace("InitialModule.", "main.").Replace("EmissionModule.", "emission.")}.scalar' / '.minMaxState'.";
                }
            }

            return PropertyOps.ApplyValue(sp, value, null);
        }

        static void SetMinMaxCurveConstant(SerializedProperty sp, SerializedProperty stateProp, float v)
        {
            stateProp.intValue = 0; // ParticleSystemCurveMode.Constant
            var scalar = sp.FindPropertyRelative("scalar");
            var minScalar = sp.FindPropertyRelative("minScalar");
            if (scalar != null) scalar.floatValue = v;
            if (minScalar != null) minScalar.floatValue = v;
        }

        static void SetMinMaxCurveTwoConstants(SerializedProperty sp, SerializedProperty stateProp, float min, float max)
        {
            stateProp.intValue = 3; // TwoConstants
            var scalar = sp.FindPropertyRelative("scalar");
            var minScalar = sp.FindPropertyRelative("minScalar");
            if (scalar != null) scalar.floatValue = max;
            if (minScalar != null) minScalar.floatValue = min;
        }

        static bool TryAsScalar(object value, out float v)
        {
            v = 0f;
            if (value == null) return false;
            try
            {
                switch (value)
                {
                    case double d: v = (float)d; return true;
                    case float f: v = f; return true;
                    case long l: v = l; return true;
                    case int i: v = i; return true;
                    case decimal m: v = (float)m; return true;
                    case string s when float.TryParse(s, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var parsed): v = parsed; return true;
                }
            }
            catch { }
            return false;
        }

        static bool TryAsMinMaxObject(object value, out float min, out float max)
        {
            min = 0f; max = 0f;
            if (value is Dictionary<string, object> dict)
            {
                bool hasMin = dict.ContainsKey("min") && TryAsScalar(dict["min"], out min);
                bool hasMax = dict.ContainsKey("max") && TryAsScalar(dict["max"], out max);
                return hasMin && hasMax;
            }
            return false;
        }
    }
}
