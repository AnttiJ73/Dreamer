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
                        .Put("transitionCount", s.transitions.Length);

                    // Distinguish blend tree from clip — both are Motion but
                    // a BlendTree state is fundamentally different (has children,
                    // blend params). Surface enough to round-trip without an
                    // extra inspect call.
                    var blendTree = s.motion as BlendTree;
                    if (blendTree != null)
                    {
                        item.Put("motionType", "BlendTree");
                        item.PutRaw("blendTree", BuildBlendTreeJson(blendTree));
                        item.PutNull("motionPath");
                    }
                    else if (s.motion != null)
                    {
                        item.Put("motionType", "Clip");
                        item.Put("motionPath", AssetDatabase.GetAssetPath(s.motion));
                    }
                    else
                    {
                        item.PutNull("motionPath");
                    }
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
                    .Put("defaultWeight", layer.defaultWeight)
                    .Put("blending", layer.blendingMode.ToString())
                    .Put("ikPass", layer.iKPass)
                    .Put("syncedLayerIndex", layer.syncedLayerIndex)
                    .Put("syncedLayerAffectsTiming", layer.syncedLayerAffectsTiming)
                    .Put("avatarMaskPath", layer.avatarMask != null ? AssetDatabase.GetAssetPath(layer.avatarMask) : null)
                    .Put("defaultState", sm.defaultState != null ? sm.defaultState.name : null)
                    .Put("stateCount", sm.states.Length)
                    .PutRaw("states", statesJson.ToString())
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

        // ── remove-animator-parameter ─────────────────────────────────────

        public static CommandResult RemoveAnimatorParameter(Dictionary<string, object> args)
        {
            var ctrl = LoadController(args, out string err);
            if (ctrl == null) return CommandResult.Fail(err);

            string paramName = SimpleJson.GetString(args, "name");
            if (string.IsNullOrEmpty(paramName)) return CommandResult.Fail("'name' is required.");

            int idx = -1;
            for (int i = 0; i < ctrl.parameters.Length; i++)
                if (ctrl.parameters[i].name == paramName) { idx = i; break; }
            if (idx < 0) return CommandResult.Fail($"Parameter '{paramName}' not found.");

            // Surface dependents — agents typically want to know what'll silently
            // break before they remove (Unity tolerates dangling param references
            // at runtime; conditions just never fire).
            var dependents = new List<string>();
            foreach (var layer in ctrl.layers)
            {
                var sm = layer.stateMachine;
                foreach (var sc in sm.states)
                    foreach (var t in sc.state.transitions)
                        foreach (var c in t.conditions)
                            if (c.parameter == paramName)
                                dependents.Add($"{layer.name}: {sc.state.name}->{(t.destinationState != null ? t.destinationState.name : "Exit")}");
                foreach (var t in sm.anyStateTransitions)
                    foreach (var c in t.conditions)
                        if (c.parameter == paramName)
                            dependents.Add($"{layer.name}: AnyState->{(t.destinationState != null ? t.destinationState.name : "?")}");
            }

            bool force = SimpleJson.GetBool(args, "force", false);
            if (dependents.Count > 0 && !force)
                return CommandResult.Fail($"Parameter '{paramName}' is referenced by {dependents.Count} transition condition(s): {string.Join("; ", dependents)}. Pass --force to remove anyway (the conditions remain, but Unity won't evaluate them — they become silent no-ops).");

            ctrl.RemoveParameter(idx);
            EditorUtility.SetDirty(ctrl);
            AssetDatabase.SaveAssets();

            return CommandResult.Ok(SimpleJson.Object()
                .Put("removed", true)
                .Put("assetPath", AssetDatabase.GetAssetPath(ctrl))
                .Put("name", paramName)
                .Put("parameterCount", ctrl.parameters.Length)
                .Put("orphanedConditions", dependents.Count)
                .ToString());
        }

        // ── remove-animator-state ─────────────────────────────────────────

        public static CommandResult RemoveAnimatorState(Dictionary<string, object> args)
        {
            var ctrl = LoadController(args, out string err);
            if (ctrl == null) return CommandResult.Fail(err);

            int layerIdx = (int)GetDouble(args, "layer", 0);
            if (layerIdx < 0 || layerIdx >= ctrl.layers.Length)
                return CommandResult.Fail($"Layer index {layerIdx} out of range.");

            string stateName = SimpleJson.GetString(args, "name");
            if (string.IsNullOrEmpty(stateName)) return CommandResult.Fail("'name' is required.");

            var sm = ctrl.layers[layerIdx].stateMachine;
            var state = FindState(sm, stateName);
            if (state == null) return CommandResult.Fail($"State '{stateName}' not found on layer {layerIdx}.");

            // Count incoming transitions across the layer (Unity's RemoveState
            // cleans up outgoing automatically but incoming references can be
            // left as null destinations on the source side).
            int incoming = 0;
            foreach (var sc in sm.states)
                foreach (var t in sc.state.transitions)
                    if (t.destinationState == state) incoming++;
            foreach (var t in sm.anyStateTransitions)
                if (t.destinationState == state) incoming++;

            sm.RemoveState(state);

            // Pre-emptively scrub now-dangling transitions on the source side.
            foreach (var sc in sm.states)
            {
                var keep = new List<AnimatorStateTransition>();
                foreach (var t in sc.state.transitions)
                    if (t.destinationState != null || t.isExit) keep.Add(t);
                if (keep.Count != sc.state.transitions.Length)
                {
                    foreach (var t in sc.state.transitions)
                        if (t.destinationState == null && !t.isExit)
                            sc.state.RemoveTransition(t);
                }
            }
            // Remove dangling AnyState transitions too.
            var anyKeep = new List<AnimatorStateTransition>();
            foreach (var t in sm.anyStateTransitions)
                if (t.destinationState != null) anyKeep.Add(t);
            foreach (var t in sm.anyStateTransitions)
                if (t.destinationState == null) sm.RemoveAnyStateTransition(t);

            EditorUtility.SetDirty(ctrl);
            AssetDatabase.SaveAssets();

            return CommandResult.Ok(SimpleJson.Object()
                .Put("removed", true)
                .Put("assetPath", AssetDatabase.GetAssetPath(ctrl))
                .Put("layer", layerIdx)
                .Put("name", stateName)
                .Put("incomingTransitionsCleaned", incoming)
                .Put("stateCount", sm.states.Length)
                .ToString());
        }

        // ── remove-animator-transition ────────────────────────────────────

        public static CommandResult RemoveAnimatorTransition(Dictionary<string, object> args)
        {
            var ctrl = LoadController(args, out string err);
            if (ctrl == null) return CommandResult.Fail(err);

            int layerIdx = (int)GetDouble(args, "layer", 0);
            if (layerIdx < 0 || layerIdx >= ctrl.layers.Length)
                return CommandResult.Fail($"Layer index {layerIdx} out of range.");

            string fromName = SimpleJson.GetString(args, "from");
            string toName = SimpleJson.GetString(args, "to");
            if (string.IsNullOrEmpty(fromName) || string.IsNullOrEmpty(toName))
                return CommandResult.Fail("'from' and 'to' are required.");
            int wantIdx = (int)GetDouble(args, "index", 0);

            var sm = ctrl.layers[layerIdx].stateMachine;
            bool fromAny = string.Equals(fromName, "AnyState", StringComparison.OrdinalIgnoreCase) ||
                           string.Equals(fromName, "Any State", StringComparison.OrdinalIgnoreCase);
            bool toExit = string.Equals(toName, "Exit", StringComparison.OrdinalIgnoreCase);

            int matched = 0;
            if (fromAny)
            {
                AnimatorStateTransition target = null;
                int seen = 0;
                foreach (var t in sm.anyStateTransitions)
                {
                    bool dstMatches = toExit ? false : (t.destinationState != null && t.destinationState.name == toName);
                    if (dstMatches) { matched++; if (seen++ == wantIdx) { target = t; } }
                }
                if (target == null)
                    return CommandResult.Fail($"No AnyState→{toName} transition at index {wantIdx} (found {matched} matches).");
                sm.RemoveAnyStateTransition(target);
            }
            else
            {
                var src = FindState(sm, fromName);
                if (src == null) return CommandResult.Fail($"Source state '{fromName}' not found on layer {layerIdx}.");

                AnimatorStateTransition target = null;
                int seen = 0;
                foreach (var t in src.transitions)
                {
                    bool dstMatches = toExit ? t.isExit : (t.destinationState != null && t.destinationState.name == toName);
                    if (dstMatches) { matched++; if (seen++ == wantIdx) { target = t; } }
                }
                if (target == null)
                    return CommandResult.Fail($"No {fromName}→{toName} transition at index {wantIdx} (found {matched} matches).");
                src.RemoveTransition(target);
            }

            EditorUtility.SetDirty(ctrl);
            AssetDatabase.SaveAssets();

            return CommandResult.Ok(SimpleJson.Object()
                .Put("removed", true)
                .Put("assetPath", AssetDatabase.GetAssetPath(ctrl))
                .Put("layer", layerIdx)
                .Put("from", fromName)
                .Put("to", toName)
                .Put("index", wantIdx)
                .ToString());
        }

        // ── update-animator-state ─────────────────────────────────────────

        public static CommandResult UpdateAnimatorState(Dictionary<string, object> args)
        {
            var ctrl = LoadController(args, out string err);
            if (ctrl == null) return CommandResult.Fail(err);

            int layerIdx = (int)GetDouble(args, "layer", 0);
            if (layerIdx < 0 || layerIdx >= ctrl.layers.Length)
                return CommandResult.Fail($"Layer index {layerIdx} out of range.");

            string stateName = SimpleJson.GetString(args, "name");
            if (string.IsNullOrEmpty(stateName)) return CommandResult.Fail("'name' is required.");

            var sm = ctrl.layers[layerIdx].stateMachine;
            var state = FindState(sm, stateName);
            if (state == null) return CommandResult.Fail($"State '{stateName}' not found on layer {layerIdx}.");

            var changed = new List<string>();

            string newName = SimpleJson.GetString(args, "rename");
            if (!string.IsNullOrEmpty(newName) && newName != stateName)
            {
                if (FindState(sm, newName) != null)
                    return CommandResult.Fail($"Cannot rename to '{newName}' — a state with that name already exists.");
                state.name = newName;
                changed.Add("rename");
            }

            if (args.ContainsKey("motion"))
            {
                string motionPath = SimpleJson.GetString(args, "motion");
                if (string.IsNullOrEmpty(motionPath))
                {
                    state.motion = null;
                    changed.Add("motion=null");
                }
                else
                {
                    var clip = AssetDatabase.LoadAssetAtPath<AnimationClip>(motionPath);
                    if (clip == null) return CommandResult.Fail($"AnimationClip not found at '{motionPath}'.");
                    state.motion = clip;
                    changed.Add("motion");
                }
            }

            if (args.ContainsKey("speed")) { state.speed = (float)GetDouble(args, "speed", 1.0); changed.Add("speed"); }
            if (args.ContainsKey("mirror")) { state.mirror = SimpleJson.GetBool(args, "mirror", false); changed.Add("mirror"); }
            if (args.ContainsKey("cycleOffset")) { state.cycleOffset = (float)GetDouble(args, "cycleOffset", 0.0); changed.Add("cycleOffset"); }
            if (args.ContainsKey("writeDefaultValues")) { state.writeDefaultValues = SimpleJson.GetBool(args, "writeDefaultValues", true); changed.Add("writeDefaultValues"); }

            EditorUtility.SetDirty(ctrl);
            AssetDatabase.SaveAssets();

            return CommandResult.Ok(SimpleJson.Object()
                .Put("updated", true)
                .Put("assetPath", AssetDatabase.GetAssetPath(ctrl))
                .Put("layer", layerIdx)
                .Put("name", state.name)
                .Put("changedFieldCount", changed.Count)
                .Put("changedFields", changed.ToArray())
                .ToString());
        }

        // ── update-animator-transition ────────────────────────────────────

        public static CommandResult UpdateAnimatorTransition(Dictionary<string, object> args)
        {
            var ctrl = LoadController(args, out string err);
            if (ctrl == null) return CommandResult.Fail(err);

            int layerIdx = (int)GetDouble(args, "layer", 0);
            if (layerIdx < 0 || layerIdx >= ctrl.layers.Length)
                return CommandResult.Fail($"Layer index {layerIdx} out of range.");

            string fromName = SimpleJson.GetString(args, "from");
            string toName = SimpleJson.GetString(args, "to");
            if (string.IsNullOrEmpty(fromName) || string.IsNullOrEmpty(toName))
                return CommandResult.Fail("'from' and 'to' are required.");
            int wantIdx = (int)GetDouble(args, "index", 0);

            var sm = ctrl.layers[layerIdx].stateMachine;
            bool fromAny = string.Equals(fromName, "AnyState", StringComparison.OrdinalIgnoreCase) ||
                           string.Equals(fromName, "Any State", StringComparison.OrdinalIgnoreCase);
            bool toExit = string.Equals(toName, "Exit", StringComparison.OrdinalIgnoreCase);

            AnimatorStateTransition transition = null;
            if (fromAny)
            {
                int seen = 0;
                foreach (var t in sm.anyStateTransitions)
                {
                    bool dstMatches = toExit ? false : (t.destinationState != null && t.destinationState.name == toName);
                    if (dstMatches && seen++ == wantIdx) { transition = t; break; }
                }
            }
            else
            {
                var src = FindState(sm, fromName);
                if (src == null) return CommandResult.Fail($"Source state '{fromName}' not found.");
                int seen = 0;
                foreach (var t in src.transitions)
                {
                    bool dstMatches = toExit ? t.isExit : (t.destinationState != null && t.destinationState.name == toName);
                    if (dstMatches && seen++ == wantIdx) { transition = t; break; }
                }
            }
            if (transition == null)
                return CommandResult.Fail($"No {fromName}→{toName} transition at index {wantIdx} on layer {layerIdx}.");

            var changed = new List<string>();
            if (args.ContainsKey("hasExitTime")) { transition.hasExitTime = SimpleJson.GetBool(args, "hasExitTime", false); changed.Add("hasExitTime"); }
            if (args.ContainsKey("exitTime")) { transition.exitTime = (float)GetDouble(args, "exitTime", 0.9); changed.Add("exitTime"); }
            if (args.ContainsKey("duration")) { transition.duration = (float)GetDouble(args, "duration", 0.1); changed.Add("duration"); }
            if (args.ContainsKey("offset")) { transition.offset = (float)GetDouble(args, "offset", 0.0); changed.Add("offset"); }
            if (args.ContainsKey("canTransitionToSelf")) { transition.canTransitionToSelf = SimpleJson.GetBool(args, "canTransitionToSelf", false); changed.Add("canTransitionToSelf"); }
            if (args.ContainsKey("interruptionSource"))
            {
                string src = SimpleJson.GetString(args, "interruptionSource", "None");
                if (Enum.TryParse(src, true, out TransitionInterruptionSource enumVal)) { transition.interruptionSource = enumVal; changed.Add("interruptionSource"); }
                else return CommandResult.Fail($"Unknown interruptionSource '{src}'. Use None|Source|Destination|SourceThenDestination|DestinationThenSource.");
            }

            // Conditions: replace whole list when provided.
            if (args.ContainsKey("conditions"))
            {
                object condsRaw = args["conditions"];
                if (condsRaw is List<object> condsList)
                {
                    // Clear existing and rebuild.
                    transition.conditions = new AnimatorCondition[0];
                    foreach (var item in condsList)
                    {
                        if (!(item is Dictionary<string, object> c))
                            return CommandResult.Fail("Each condition must be {parameter, mode, threshold?}.");
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
                            default: return CommandResult.Fail($"Unknown condition mode '{mode}'.");
                        }
                        float threshold = 0f;
                        if (c.ContainsKey("threshold"))
                            try { threshold = Convert.ToSingle(c["threshold"], System.Globalization.CultureInfo.InvariantCulture); }
                            catch { return CommandResult.Fail("Condition.threshold must be a number."); }
                        transition.AddCondition(condMode, threshold, pName);
                    }
                    changed.Add($"conditions (replaced with {condsList.Count})");
                }
            }

            EditorUtility.SetDirty(ctrl);
            AssetDatabase.SaveAssets();

            return CommandResult.Ok(SimpleJson.Object()
                .Put("updated", true)
                .Put("assetPath", AssetDatabase.GetAssetPath(ctrl))
                .Put("layer", layerIdx)
                .Put("from", fromName)
                .Put("to", toName)
                .Put("index", wantIdx)
                .Put("changedFieldCount", changed.Count)
                .Put("changedFields", changed.ToArray())
                .ToString());
        }

        // ── add-animator-layer ────────────────────────────────────────────

        public static CommandResult AddAnimatorLayer(Dictionary<string, object> args)
        {
            var ctrl = LoadController(args, out string err);
            if (ctrl == null) return CommandResult.Fail(err);

            string layerName = SimpleJson.GetString(args, "name");
            if (string.IsNullOrEmpty(layerName)) return CommandResult.Fail("'name' is required.");

            // Reject duplicates.
            foreach (var l in ctrl.layers)
                if (l.name == layerName) return CommandResult.Fail($"Layer '{layerName}' already exists.");

            // AnimatorController.AddLayer creates layer + state machine. Set
            // properties through the layer struct, then write back the whole
            // layers array (Unity requires this round-trip to persist).
            ctrl.AddLayer(layerName);
            var layers = ctrl.layers;
            int newIdx = layers.Length - 1;
            var newLayer = layers[newIdx];

            if (args.ContainsKey("weight"))
                newLayer.defaultWeight = (float)GetDouble(args, "weight", 1.0f);

            if (args.ContainsKey("blending"))
            {
                string b = SimpleJson.GetString(args, "blending", "Override");
                if (string.Equals(b, "Override", StringComparison.OrdinalIgnoreCase)) newLayer.blendingMode = AnimatorLayerBlendingMode.Override;
                else if (string.Equals(b, "Additive", StringComparison.OrdinalIgnoreCase)) newLayer.blendingMode = AnimatorLayerBlendingMode.Additive;
                else return CommandResult.Fail($"blending must be Override or Additive; got '{b}'.");
            }

            if (args.ContainsKey("ikPass"))
                newLayer.iKPass = SimpleJson.GetBool(args, "ikPass", false);

            string maskPath = SimpleJson.GetString(args, "mask");
            if (!string.IsNullOrEmpty(maskPath))
            {
                var mask = AssetDatabase.LoadAssetAtPath<AvatarMask>(maskPath);
                if (mask == null) return CommandResult.Fail($"AvatarMask not found at '{maskPath}'.");
                newLayer.avatarMask = mask;
            }

            layers[newIdx] = newLayer;
            ctrl.layers = layers;

            EditorUtility.SetDirty(ctrl);
            AssetDatabase.SaveAssets();

            return CommandResult.Ok(SimpleJson.Object()
                .Put("added", true)
                .Put("assetPath", AssetDatabase.GetAssetPath(ctrl))
                .Put("layerIndex", newIdx)
                .Put("name", layerName)
                .Put("weight", newLayer.defaultWeight)
                .Put("blending", newLayer.blendingMode.ToString())
                .Put("hasMask", newLayer.avatarMask != null)
                .ToString());
        }

        // ── remove-animator-layer ─────────────────────────────────────────

        public static CommandResult RemoveAnimatorLayer(Dictionary<string, object> args)
        {
            var ctrl = LoadController(args, out string err);
            if (ctrl == null) return CommandResult.Fail(err);

            int layerIdx = (int)GetDouble(args, "layer", -1);
            if (layerIdx < 0) return CommandResult.Fail("'layer' (index) is required.");
            if (layerIdx == 0) return CommandResult.Fail("Layer 0 (the base layer) cannot be removed — every controller needs at least one layer.");
            if (layerIdx >= ctrl.layers.Length) return CommandResult.Fail($"Layer index {layerIdx} out of range.");

            string layerName = ctrl.layers[layerIdx].name;
            ctrl.RemoveLayer(layerIdx);
            EditorUtility.SetDirty(ctrl);
            AssetDatabase.SaveAssets();

            return CommandResult.Ok(SimpleJson.Object()
                .Put("removed", true)
                .Put("assetPath", AssetDatabase.GetAssetPath(ctrl))
                .Put("layerIndex", layerIdx)
                .Put("name", layerName)
                .Put("layerCount", ctrl.layers.Length)
                .ToString());
        }

        // ── set-animator-layer ────────────────────────────────────────────

        public static CommandResult SetAnimatorLayer(Dictionary<string, object> args)
        {
            var ctrl = LoadController(args, out string err);
            if (ctrl == null) return CommandResult.Fail(err);

            int layerIdx = (int)GetDouble(args, "layer", -1);
            if (layerIdx < 0 || layerIdx >= ctrl.layers.Length)
                return CommandResult.Fail($"'layer' index {layerIdx} out of range.");

            var layers = ctrl.layers;
            var layer = layers[layerIdx];
            var changed = new List<string>();

            if (args.ContainsKey("name"))
            {
                string newName = SimpleJson.GetString(args, "name");
                if (string.IsNullOrEmpty(newName)) return CommandResult.Fail("layer name cannot be empty.");
                foreach (var other in layers)
                    if (other.name == newName && other.stateMachine != layer.stateMachine)
                        return CommandResult.Fail($"Another layer already named '{newName}'.");
                layer.name = newName;
                changed.Add("name");
            }
            if (args.ContainsKey("weight")) { layer.defaultWeight = (float)GetDouble(args, "weight", 1.0f); changed.Add("weight"); }
            if (args.ContainsKey("blending"))
            {
                string b = SimpleJson.GetString(args, "blending");
                if (string.Equals(b, "Override", StringComparison.OrdinalIgnoreCase)) layer.blendingMode = AnimatorLayerBlendingMode.Override;
                else if (string.Equals(b, "Additive", StringComparison.OrdinalIgnoreCase)) layer.blendingMode = AnimatorLayerBlendingMode.Additive;
                else return CommandResult.Fail($"blending must be Override or Additive.");
                changed.Add("blending");
            }
            if (args.ContainsKey("ikPass")) { layer.iKPass = SimpleJson.GetBool(args, "ikPass", false); changed.Add("ikPass"); }

            if (args.ContainsKey("mask"))
            {
                string maskPath = SimpleJson.GetString(args, "mask");
                if (string.IsNullOrEmpty(maskPath))
                {
                    layer.avatarMask = null;
                    changed.Add("mask=null");
                }
                else
                {
                    var mask = AssetDatabase.LoadAssetAtPath<AvatarMask>(maskPath);
                    if (mask == null) return CommandResult.Fail($"AvatarMask not found at '{maskPath}'.");
                    layer.avatarMask = mask;
                    changed.Add("mask");
                }
            }

            if (args.ContainsKey("syncedLayerIndex")) { layer.syncedLayerIndex = (int)GetDouble(args, "syncedLayerIndex", -1); changed.Add("syncedLayerIndex"); }
            if (args.ContainsKey("syncedLayerAffectsTiming")) { layer.syncedLayerAffectsTiming = SimpleJson.GetBool(args, "syncedLayerAffectsTiming", false); changed.Add("syncedLayerAffectsTiming"); }

            layers[layerIdx] = layer;
            ctrl.layers = layers;

            EditorUtility.SetDirty(ctrl);
            AssetDatabase.SaveAssets();

            return CommandResult.Ok(SimpleJson.Object()
                .Put("set", true)
                .Put("assetPath", AssetDatabase.GetAssetPath(ctrl))
                .Put("layerIndex", layerIdx)
                .Put("changedFieldCount", changed.Count)
                .Put("changedFields", changed.ToArray())
                .ToString());
        }

        // ── add-animator-blend-tree ───────────────────────────────────────

        public static CommandResult AddAnimatorBlendTree(Dictionary<string, object> args)
        {
            var ctrl = LoadController(args, out string err);
            if (ctrl == null) return CommandResult.Fail(err);

            int layerIdx = (int)GetDouble(args, "layer", 0);
            if (layerIdx < 0 || layerIdx >= ctrl.layers.Length)
                return CommandResult.Fail($"Layer index {layerIdx} out of range.");

            string stateName = SimpleJson.GetString(args, "name");
            if (string.IsNullOrEmpty(stateName)) return CommandResult.Fail("'name' is required (the state name that will hold the blend tree).");

            string typeStr = SimpleJson.GetString(args, "type", "1d")?.ToLowerInvariant();
            BlendTreeType blendType;
            switch (typeStr)
            {
                case "1d":                          blendType = BlendTreeType.Simple1D; break;
                case "2d-simple":                   blendType = BlendTreeType.SimpleDirectional2D; break;
                case "2d-freeform-directional":     blendType = BlendTreeType.FreeformDirectional2D; break;
                case "2d-freeform-cartesian":       blendType = BlendTreeType.FreeformCartesian2D; break;
                case "direct":                      blendType = BlendTreeType.Direct; break;
                default: return CommandResult.Fail($"Unknown blend tree type '{typeStr}'. Use 1d|2d-simple|2d-freeform-directional|2d-freeform-cartesian|direct.");
            }

            var sm = ctrl.layers[layerIdx].stateMachine;
            if (FindState(sm, stateName) != null)
                return CommandResult.Fail($"State '{stateName}' already exists on layer {layerIdx}.");

            // Create state + blend tree as a sub-asset of the controller (so
            // the blend tree's children/thresholds save with the controller
            // file). AddState + state.motion = new BlendTree {...} works in
            // Unity 2022+; the blend tree inherits AddObjectToAsset from the
            // controller automatically when assigned to state.motion via
            // CreateBlendTreeInController.
            BlendTree blendTree;
            var state = ctrl.CreateBlendTreeInController(stateName, out blendTree, layerIdx);
            blendTree.blendType = blendType;

            // Blend parameter(s).
            string param = SimpleJson.GetString(args, "blendParameter");
            if (!string.IsNullOrEmpty(param)) blendTree.blendParameter = param;
            string paramY = SimpleJson.GetString(args, "blendParameterY");
            if (!string.IsNullOrEmpty(paramY)) blendTree.blendParameterY = paramY;

            // Children — array of {motion, threshold?, position?, timeScale?, mirror?, directBlendParameter?}.
            int childCount = 0;
            object childrenRaw = SimpleJson.GetValue(args, "children");
            if (childrenRaw is List<object> childrenList)
            {
                foreach (var item in childrenList)
                {
                    if (!(item is Dictionary<string, object> c))
                        return CommandResult.Fail("Each child must be {motion, threshold?, position?, ...}.");
                    string motionPath = SimpleJson.GetString(c, "motion");
                    Motion motion = null;
                    if (!string.IsNullOrEmpty(motionPath))
                    {
                        motion = AssetDatabase.LoadAssetAtPath<Motion>(motionPath);
                        if (motion == null) return CommandResult.Fail($"Motion (AnimationClip or BlendTree) not found at '{motionPath}'.");
                    }

                    // 1D: threshold; 2D: position [x,y]; Direct: directBlendParameter.
                    if (blendType == BlendTreeType.Simple1D)
                    {
                        float threshold = (float)GetDouble(c, "threshold", childCount);
                        if (motion != null) blendTree.AddChild(motion, threshold);
                        else blendTree.AddChild((AnimationClip)null, threshold);
                    }
                    else if (blendType == BlendTreeType.Direct)
                    {
                        if (motion != null) blendTree.AddChild(motion);
                        else blendTree.AddChild((AnimationClip)null);
                        // Direct param assignment via children-array round-trip.
                        var children = blendTree.children;
                        var last = children[children.Length - 1];
                        last.directBlendParameter = SimpleJson.GetString(c, "directBlendParameter") ?? "";
                        children[children.Length - 1] = last;
                        blendTree.children = children;
                    }
                    else // 2D variants
                    {
                        Vector2 pos = Vector2.zero;
                        object posRaw = SimpleJson.GetValue(c, "position");
                        if (posRaw is List<object> posArr && posArr.Count >= 2)
                        {
                            pos = new Vector2(
                                (float)Convert.ToDouble(posArr[0], System.Globalization.CultureInfo.InvariantCulture),
                                (float)Convert.ToDouble(posArr[1], System.Globalization.CultureInfo.InvariantCulture));
                        }
                        if (motion != null) blendTree.AddChild(motion, pos);
                        else blendTree.AddChild((AnimationClip)null, pos);
                    }

                    // Per-child timeScale / mirror via children round-trip.
                    if (c.ContainsKey("timeScale") || c.ContainsKey("mirror") || c.ContainsKey("cycleOffset"))
                    {
                        var children = blendTree.children;
                        var last = children[children.Length - 1];
                        if (c.ContainsKey("timeScale")) last.timeScale = (float)GetDouble(c, "timeScale", 1.0);
                        if (c.ContainsKey("mirror")) last.mirror = SimpleJson.GetBool(c, "mirror", false);
                        if (c.ContainsKey("cycleOffset")) last.cycleOffset = (float)GetDouble(c, "cycleOffset", 0.0);
                        children[children.Length - 1] = last;
                        blendTree.children = children;
                    }
                    childCount++;
                }
            }

            EditorUtility.SetDirty(ctrl);
            AssetDatabase.SaveAssets();

            return CommandResult.Ok(SimpleJson.Object()
                .Put("added", true)
                .Put("assetPath", AssetDatabase.GetAssetPath(ctrl))
                .Put("layer", layerIdx)
                .Put("name", stateName)
                .Put("type", typeStr)
                .Put("blendParameter", blendTree.blendParameter)
                .Put("blendParameterY", blendTree.blendParameterY)
                .Put("childCount", childCount)
                .Put("isDefault", sm.defaultState == state)
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

        static string BuildBlendTreeJson(BlendTree bt)
        {
            string typeStr;
            switch (bt.blendType)
            {
                case BlendTreeType.Simple1D:               typeStr = "1d"; break;
                case BlendTreeType.SimpleDirectional2D:    typeStr = "2d-simple"; break;
                case BlendTreeType.FreeformDirectional2D:  typeStr = "2d-freeform-directional"; break;
                case BlendTreeType.FreeformCartesian2D:    typeStr = "2d-freeform-cartesian"; break;
                case BlendTreeType.Direct:                 typeStr = "direct"; break;
                default: typeStr = bt.blendType.ToString(); break;
            }
            var children = SimpleJson.Array();
            foreach (var c in bt.children)
            {
                var motionPath = c.motion != null ? AssetDatabase.GetAssetPath(c.motion) : null;
                var entry = SimpleJson.Object()
                    .Put("motion", motionPath)
                    .Put("motionName", c.motion != null ? c.motion.name : null)
                    .Put("threshold", c.threshold)
                    .PutRaw("position", $"[{c.position.x},{c.position.y}]")
                    .Put("timeScale", c.timeScale)
                    .Put("mirror", c.mirror)
                    .Put("cycleOffset", c.cycleOffset);
                if (bt.blendType == BlendTreeType.Direct)
                    entry.Put("directBlendParameter", c.directBlendParameter ?? "");
                children.AddRaw(entry.ToString());
            }
            return SimpleJson.Object()
                .Put("type", typeStr)
                .Put("blendParameter", bt.blendParameter)
                .Put("blendParameterY", bt.blendParameterY)
                .Put("childCount", bt.children.Length)
                .PutRaw("children", children.ToString())
                .ToString();
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
