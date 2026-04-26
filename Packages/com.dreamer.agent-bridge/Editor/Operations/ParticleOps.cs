using System;
using System.Collections.Generic;
using UnityEditor;
using UnityEngine;

namespace Dreamer.AgentBridge
{
    /// <summary>
    /// ParticleSystem property writer. Necessary because PS exposes its config
    /// through C# wrapper structs (MainModule, EmissionModule, ...) accessed as
    /// instance properties — those wrappers proxy to native code, so you can't
    /// reach `main.startLifetime` through generic set-property reflection. The
    /// underlying *serialized* field names also don't match the API: `main`
    /// serializes as `InitialModule`, `limitVelocityOverLifetime` as
    /// `ClampVelocityModule`, etc.
    ///
    /// This handler does two things the generic resolver can't:
    ///   1. Rewrite API-style first segments to their serialized equivalents.
    ///   2. Expand a bare scalar value to MinMaxCurve.scalar + minMaxState=0
    ///      when the target field is a MinMaxCurve struct (the common case
    ///      for `startLifetime`, `startSpeed`, `startSize`, `rateOverTime`,
    ///      most numeric fields under modules).
    /// </summary>
    public static class ParticleOps
    {
        // C# API name → SerializedProperty name. Ordering reflects ParticleSystem.cs
        // public surface; verified against Unity's serialization layout.
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

        // "main.startLifetime"           → "InitialModule.startLifetime"
        // "emission.rateOverTime.scalar" → "EmissionModule.rateOverTime.scalar"
        // "lengthInSec"                  → "lengthInSec"  (no module prefix; pass-through)
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
            // MinMaxCurve struct detection: presence of "minMaxState" child marks it.
            // A bare scalar from the user → set scalar+minScalar, mode=Constant.
            // A {min, max} object → set scalar=max, minScalar=min, mode=TwoConstants.
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
                    // For richer MinMaxCurve assignments (curves, two-curves, gradient curves)
                    // the agent should use explicit subpath access:
                    //   set-particle-property --property "main.startLifetime.scalar" --value 5
                    //   set-particle-property --property "main.startLifetime.minMaxState" --value 0
                    return $"MinMaxCurve at '{sp.propertyPath}' takes a scalar (constant) or {{min, max}} (two constants). For curves, set sub-fields explicitly: '{sp.propertyPath.Replace("InitialModule.", "main.").Replace("EmissionModule.", "emission.")}.scalar' / '.minMaxState'.";
                }
            }

            // Fall through to the generic resolver for everything else: bools, ints,
            // floats, vectors, colors, object references, arrays, structs.
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
            stateProp.intValue = 3; // ParticleSystemCurveMode.TwoConstants
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
