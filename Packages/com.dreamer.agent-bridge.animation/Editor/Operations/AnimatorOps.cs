using System;
using System.Collections.Generic;
using System.IO;
using UnityEditor;
using UnityEditor.Animations;
using UnityEngine;

namespace Dreamer.AgentBridge.Animation
{
    /// <summary>
    /// AnimatorController authoring — create the asset, add parameters,
    /// add states with optional Motion clips, wire transitions with
    /// conditions, set default state, inspect the result.
    ///
    /// State-machine root only (layer 0 by default; --layer N for others).
    /// Sub-state machines, blend trees, and per-layer masks are out of
    /// scope for v1 — author them in the Unity Animator window if needed.
    /// </summary>
    public static class AnimatorOps
    {
        // ── create-animator-controller ────────────────────────────────────

        public static CommandResult CreateAnimatorController(Dictionary<string, object> args)
        {
            string name = SimpleJson.GetString(args, "name");
            if (string.IsNullOrEmpty(name)) return CommandResult.Fail("'name' is required.");

            string folder = SimpleJson.GetString(args, "path", "Assets/Animations");
            if (!AssetDatabase.IsValidFolder(folder))
            {
                string fullDir = Path.GetFullPath(folder);
                if (!Directory.Exists(fullDir))
                {
                    Directory.CreateDirectory(fullDir);
                    AssetDatabase.Refresh();
                }
            }

            string assetPath = $"{folder}/{name}.controller";
            if (File.Exists(Path.GetFullPath(assetPath)))
                return CommandResult.Fail($"Animator controller already exists at '{assetPath}'.");

            var controller = AnimatorController.CreateAnimatorControllerAtPath(assetPath);
            AssetDatabase.SaveAssets();

            return CommandResult.Ok(SimpleJson.Object()
                .Put("created", true)
                .Put("assetPath", assetPath)
                .Put("name", name)
                .Put("layerCount", controller.layers.Length)
                .ToString());
        }

        // ── add-animator-parameter ────────────────────────────────────────

        public static CommandResult AddAnimatorParameter(Dictionary<string, object> args)
        {
            var ctrl = LoadController(args, out string err);
            if (ctrl == null) return CommandResult.Fail(err);

            string paramName = SimpleJson.GetString(args, "name");
            if (string.IsNullOrEmpty(paramName)) return CommandResult.Fail("'name' is required.");
            string paramType = SimpleJson.GetString(args, "type", "bool")?.ToLowerInvariant();

            // Reject duplicates — would silently corrupt later condition lookups.
            foreach (var p in ctrl.parameters)
                if (p.name == paramName)
                    return CommandResult.Fail($"Parameter '{paramName}' already exists on '{ctrl.name}'. Names must be unique.");

            AnimatorControllerParameterType pType;
            switch (paramType)
            {
                case "bool":    pType = AnimatorControllerParameterType.Bool;    break;
                case "int":     pType = AnimatorControllerParameterType.Int;     break;
                case "float":   pType = AnimatorControllerParameterType.Float;   break;
                case "trigger": pType = AnimatorControllerParameterType.Trigger; break;
                default: return CommandResult.Fail($"Unknown parameter type '{paramType}'. Use bool|int|float|trigger.");
            }

            var newParam = new AnimatorControllerParameter
            {
                name = paramName,
                type = pType,
            };

            object def = SimpleJson.GetValue(args, "default");
            if (def != null)
            {
                try
                {
                    switch (pType)
                    {
                        case AnimatorControllerParameterType.Bool:    newParam.defaultBool   = Convert.ToBoolean(def); break;
                        case AnimatorControllerParameterType.Int:     newParam.defaultInt    = Convert.ToInt32(def);   break;
                        case AnimatorControllerParameterType.Float:   newParam.defaultFloat  = Convert.ToSingle(def);  break;
                        case AnimatorControllerParameterType.Trigger: newParam.defaultBool   = Convert.ToBoolean(def); break;
                    }
                }
                catch (Exception e) { return CommandResult.Fail($"--default could not be coerced to {paramType}: {e.Message}"); }
            }

            ctrl.AddParameter(newParam);
            AssetDatabase.SaveAssets();

            return CommandResult.Ok(SimpleJson.Object()
                .Put("added", true)
                .Put("assetPath", AssetDatabase.GetAssetPath(ctrl))
                .Put("name", paramName)
                .Put("type", paramType)
                .Put("parameterCount", ctrl.parameters.Length)
                .ToString());
        }

        // ── add-animator-state ────────────────────────────────────────────

        public static CommandResult AddAnimatorState(Dictionary<string, object> args)
        {
            var ctrl = LoadController(args, out string err);
            if (ctrl == null) return CommandResult.Fail(err);

            int layerIdx = (int)GetDouble(args, "layer", 0);
            if (layerIdx < 0 || layerIdx >= ctrl.layers.Length)
                return CommandResult.Fail($"Layer index {layerIdx} out of range (0..{ctrl.layers.Length - 1}).");

            string stateName = SimpleJson.GetString(args, "name");
            if (string.IsNullOrEmpty(stateName)) return CommandResult.Fail("'name' is required.");

            var sm = ctrl.layers[layerIdx].stateMachine;
            foreach (var c in sm.states)
                if (c.state.name == stateName)
                    return CommandResult.Fail($"State '{stateName}' already exists on layer {layerIdx}.");

            var state = sm.AddState(stateName);

            string motionPath = SimpleJson.GetString(args, "motion");
            if (!string.IsNullOrEmpty(motionPath))
            {
                var clip = AssetDatabase.LoadAssetAtPath<AnimationClip>(motionPath);
                if (clip == null) return CommandResult.Fail($"AnimationClip not found at '{motionPath}'.");
                state.motion = clip;
            }

            float speed = (float)GetDouble(args, "speed", 1.0);
            state.speed = speed;

            // First state added = automatic default. Caller may override later
            // via set-animator-default-state.
            EditorUtility.SetDirty(ctrl);
            AssetDatabase.SaveAssets();

            return CommandResult.Ok(SimpleJson.Object()
                .Put("added", true)
                .Put("assetPath", AssetDatabase.GetAssetPath(ctrl))
                .Put("layer", layerIdx)
                .Put("name", stateName)
                .Put("motion", motionPath)
                .Put("speed", speed)
                .Put("isDefault", sm.defaultState == state)
                .ToString());
        }

        // ── add-animator-transition ───────────────────────────────────────

        public static CommandResult AddAnimatorTransition(Dictionary<string, object> args)
        {
            var ctrl = LoadController(args, out string err);
            if (ctrl == null) return CommandResult.Fail(err);

            int layerIdx = (int)GetDouble(args, "layer", 0);
            if (layerIdx < 0 || layerIdx >= ctrl.layers.Length)
                return CommandResult.Fail($"Layer index {layerIdx} out of range.");

            var sm = ctrl.layers[layerIdx].stateMachine;
            string fromName = SimpleJson.GetString(args, "from");
            string toName   = SimpleJson.GetString(args, "to");
            if (string.IsNullOrEmpty(fromName)) return CommandResult.Fail("'from' is required (state name, 'AnyState', or 'Entry').");
            if (string.IsNullOrEmpty(toName))   return CommandResult.Fail("'to' is required (state name or 'Exit').");

            AnimatorState toState = null;
            bool toExit = string.Equals(toName, "Exit", StringComparison.OrdinalIgnoreCase);
            if (!toExit)
            {
                toState = FindState(sm, toName);
                if (toState == null) return CommandResult.Fail($"Destination state '{toName}' not found on layer {layerIdx}.");
            }

            AnimatorStateTransition transition;

            // Source semantics:
            //   "AnyState" / "Any State" — added via AddAnyStateTransition
            //   "Entry"                  — currently rejected (entry transitions
            //                              use AnimatorTransition, not AnimatorStateTransition,
            //                              and have a different shape with no exit time / duration).
            //                              Defer for v1 — surface a clear message instead of half-doing it.
            //   <state name>             — state.AddTransition / state.AddExitTransition
            if (string.Equals(fromName, "AnyState", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(fromName, "Any State", StringComparison.OrdinalIgnoreCase))
            {
                if (toExit) return CommandResult.Fail("AnyState → Exit is not supported by Unity. Pick a destination state.");
                transition = sm.AddAnyStateTransition(toState);
            }
            else if (string.Equals(fromName, "Entry", StringComparison.OrdinalIgnoreCase))
            {
                return CommandResult.Fail("Entry transitions are not supported in v1 (use set-animator-default-state to wire the default state, which Unity treats as the entry-point connection for most cases).");
            }
            else
            {
                var fromState = FindState(sm, fromName);
                if (fromState == null) return CommandResult.Fail($"Source state '{fromName}' not found on layer {layerIdx}.");
                transition = toExit ? fromState.AddExitTransition() : fromState.AddTransition(toState);
            }

            // Transition properties.
            bool hasExit = SimpleJson.GetBool(args, "hasExitTime", false);
            transition.hasExitTime = hasExit;
            if (hasExit) transition.exitTime = (float)GetDouble(args, "exitTime", 0.9);
            transition.duration = (float)GetDouble(args, "duration", 0.1);
            transition.offset   = (float)GetDouble(args, "offset", 0.0);
            transition.canTransitionToSelf = SimpleJson.GetBool(args, "canTransitionToSelf", false);

            // Conditions.
            object condsRaw = SimpleJson.GetValue(args, "conditions");
            if (condsRaw is List<object> condsList)
            {
                foreach (var item in condsList)
                {
                    if (!(item is Dictionary<string, object> c))
                        return CommandResult.Fail("Each condition must be an object {parameter, mode, threshold?}.");

                    string pName = SimpleJson.GetString(c, "parameter");
                    string mode = SimpleJson.GetString(c, "mode", "If")?.ToLowerInvariant();
                    if (string.IsNullOrEmpty(pName)) return CommandResult.Fail("Condition.parameter is required.");

                    AnimatorConditionMode condMode;
                    switch (mode)
                    {
                        case "if":       condMode = AnimatorConditionMode.If; break;
                        case "ifnot":    condMode = AnimatorConditionMode.IfNot; break;
                        case "greater":  condMode = AnimatorConditionMode.Greater; break;
                        case "less":     condMode = AnimatorConditionMode.Less; break;
                        case "equals":   condMode = AnimatorConditionMode.Equals; break;
                        case "notequal": condMode = AnimatorConditionMode.NotEqual; break;
                        default: return CommandResult.Fail($"Unknown condition mode '{mode}'. Use If|IfNot|Greater|Less|Equals|NotEqual.");
                    }

                    float threshold = 0f;
                    if (c.ContainsKey("threshold"))
                    {
                        try { threshold = Convert.ToSingle(c["threshold"], System.Globalization.CultureInfo.InvariantCulture); }
                        catch { return CommandResult.Fail("Condition.threshold must be a number."); }
                    }

                    transition.AddCondition(condMode, threshold, pName);
                }
            }

            EditorUtility.SetDirty(ctrl);
            AssetDatabase.SaveAssets();

            return CommandResult.Ok(SimpleJson.Object()
                .Put("added", true)
                .Put("assetPath", AssetDatabase.GetAssetPath(ctrl))
                .Put("layer", layerIdx)
                .Put("from", fromName)
                .Put("to", toName)
                .Put("conditionCount", transition.conditions.Length)
                .Put("duration", transition.duration)
                .Put("hasExitTime", transition.hasExitTime)
                .ToString());
        }

        // ── set-animator-default-state ────────────────────────────────────

        public static CommandResult SetAnimatorDefaultState(Dictionary<string, object> args)
        {
            var ctrl = LoadController(args, out string err);
            if (ctrl == null) return CommandResult.Fail(err);

            int layerIdx = (int)GetDouble(args, "layer", 0);
            if (layerIdx < 0 || layerIdx >= ctrl.layers.Length)
                return CommandResult.Fail($"Layer index {layerIdx} out of range.");

            string stateName = SimpleJson.GetString(args, "state");
            if (string.IsNullOrEmpty(stateName)) return CommandResult.Fail("'state' is required.");

            var sm = ctrl.layers[layerIdx].stateMachine;
            var st = FindState(sm, stateName);
            if (st == null) return CommandResult.Fail($"State '{stateName}' not found on layer {layerIdx}.");

            sm.defaultState = st;
            EditorUtility.SetDirty(ctrl);
            AssetDatabase.SaveAssets();

            return CommandResult.Ok(SimpleJson.Object()
                .Put("set", true)
                .Put("assetPath", AssetDatabase.GetAssetPath(ctrl))
                .Put("layer", layerIdx)
                .Put("defaultState", stateName)
                .ToString());
        }

        // ── inspect-animator-controller ───────────────────────────────────

        public static CommandResult InspectAnimatorController(Dictionary<string, object> args)
        {
            var ctrl = LoadController(args, out string err);
            if (ctrl == null) return CommandResult.Fail(err);

            var paramsJson = SimpleJson.Array();
            foreach (var p in ctrl.parameters)
            {
                var item = SimpleJson.Object()
                    .Put("name", p.name)
                    .Put("type", p.type.ToString());
                switch (p.type)
                {
                    case AnimatorControllerParameterType.Bool:    item.Put("default", p.defaultBool); break;
                    case AnimatorControllerParameterType.Int:     item.Put("default", p.defaultInt); break;
                    case AnimatorControllerParameterType.Float:   item.Put("default", p.defaultFloat); break;
                    case AnimatorControllerParameterType.Trigger: item.Put("default", p.defaultBool); break;
                }
                paramsJson.AddRaw(item.ToString());
            }

            var layersJson = SimpleJson.Array();
            for (int i = 0; i < ctrl.layers.Length; i++)
            {
                var layer = ctrl.layers[i];
                var sm = layer.stateMachine;

                var statesJson = SimpleJson.Array();
                foreach (var sc in sm.states)
                {
                    var s = sc.state;
                    var item = SimpleJson.Object()
                        .Put("name", s.name)
                        .Put("speed", s.speed)
                        .Put("isDefault", sm.defaultState == s)
                        .Put("motionPath", s.motion != null ? AssetDatabase.GetAssetPath(s.motion) : null)
                        .Put("transitionCount", s.transitions.Length);
                    statesJson.AddRaw(item.ToString());
                }

                var transJson = SimpleJson.Array();
                foreach (var sc in sm.states)
                {
                    foreach (var t in sc.state.transitions)
                    {
                        var item = SimpleJson.Object()
                            .Put("from", sc.state.name)
                            .Put("to", t.isExit ? "Exit" : (t.destinationState != null ? t.destinationState.name : null))
                            .Put("hasExitTime", t.hasExitTime)
                            .Put("exitTime", t.exitTime)
                            .Put("duration", t.duration)
                            .PutRaw("conditions", BuildConditionsJson(t.conditions));
                        transJson.AddRaw(item.ToString());
                    }
                }
                foreach (var t in sm.anyStateTransitions)
                {
                    var item = SimpleJson.Object()
                        .Put("from", "AnyState")
                        .Put("to", t.destinationState != null ? t.destinationState.name : null)
                        .Put("hasExitTime", t.hasExitTime)
                        .Put("duration", t.duration)
                        .PutRaw("conditions", BuildConditionsJson(t.conditions));
                    transJson.AddRaw(item.ToString());
                }

                var lItem = SimpleJson.Object()
                    .Put("index", i)
                    .Put("name", layer.name)
                    .Put("defaultState", sm.defaultState != null ? sm.defaultState.name : null)
                    .Put("stateCount", sm.states.Length)
                    .PutRaw("states", statesJson.ToString())
                    .Put("transitionCount", transJson.ToString().Length > 2 ? sm.states.Length : 0)
                    .PutRaw("transitions", transJson.ToString());
                layersJson.AddRaw(lItem.ToString());
            }

            return CommandResult.Ok(SimpleJson.Object()
                .Put("assetPath", AssetDatabase.GetAssetPath(ctrl))
                .Put("name", ctrl.name)
                .Put("parameterCount", ctrl.parameters.Length)
                .PutRaw("parameters", paramsJson.ToString())
                .Put("layerCount", ctrl.layers.Length)
                .PutRaw("layers", layersJson.ToString())
                .ToString());
        }

        // ── helpers ───────────────────────────────────────────────────────

        static AnimatorController LoadController(Dictionary<string, object> args, out string error)
        {
            error = null;
            string assetPath = AssetOps.ResolveAssetPath(args);
            if (string.IsNullOrEmpty(assetPath)) { error = "'assetPath' or 'guid' is required."; return null; }
            var ctrl = AssetDatabase.LoadAssetAtPath<AnimatorController>(assetPath);
            if (ctrl == null) { error = $"Failed to load AnimatorController at '{assetPath}'."; return null; }
            return ctrl;
        }

        static AnimatorState FindState(AnimatorStateMachine sm, string name)
        {
            foreach (var sc in sm.states)
                if (sc.state.name == name) return sc.state;
            return null;
        }

        static string BuildConditionsJson(AnimatorCondition[] conditions)
        {
            var arr = SimpleJson.Array();
            if (conditions == null) return arr.ToString();
            foreach (var c in conditions)
            {
                var item = SimpleJson.Object()
                    .Put("parameter", c.parameter)
                    .Put("mode", c.mode.ToString())
                    .Put("threshold", c.threshold);
                arr.AddRaw(item.ToString());
            }
            return arr.ToString();
        }

        static double GetDouble(Dictionary<string, object> args, string key, double fallback)
        {
            if (args == null || !args.ContainsKey(key) || args[key] == null) return fallback;
            try { return Convert.ToDouble(args[key], System.Globalization.CultureInfo.InvariantCulture); }
            catch { return fallback; }
        }
    }
}
