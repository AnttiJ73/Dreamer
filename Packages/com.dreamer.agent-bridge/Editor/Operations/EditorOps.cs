using System;
using System.Collections.Generic;
using System.Globalization;
using System.Reflection;
using UnityEditor;
using UnityEngine;

namespace Dreamer.AgentBridge
{
    public static class EditorOps
    {
        /// <summary>Execute a Unity Editor menu item. Args: { menuItem }</summary>
        public static CommandResult ExecuteMenuItem(Dictionary<string, object> args)
        {
            string menuItem = SimpleJson.GetString(args, "menuItem");
            if (string.IsNullOrEmpty(menuItem))
                return CommandResult.Fail("'menuItem' is required.");

            // ExecuteMenuItem silently returns false for items with validation handlers
            // (Edit/Play, Edit/Pause), so route to PlayModeOps for matching behavior.
            string routedState = TryRedirectPlayMenu(menuItem);
            if (routedState != null)
            {
                var routedArgs = new Dictionary<string, object> { { "state", routedState } };
                return PlayModeOps.SetPlayMode(routedArgs);
            }

            bool executed = EditorApplication.ExecuteMenuItem(menuItem);
            if (!executed)
                return CommandResult.Fail($"Menu item not found or not executable: {menuItem}");

            var json = SimpleJson.Object()
                .Put("executed", true)
                .Put("menuItem", menuItem)
                .ToString();

            return CommandResult.Ok(json);
        }

        /// <summary>Static-method invoker. Args coerced against the resolved overload's parameter list (SimpleJson-parsed values won't auto-cast long→int).</summary>
        public static CommandResult ExecuteMethod(Dictionary<string, object> args)
        {
            string typeName = SimpleJson.GetString(args, "typeName");
            if (string.IsNullOrEmpty(typeName))
                return CommandResult.Fail("'typeName' is required.");

            string methodName = SimpleJson.GetString(args, "methodName");
            if (string.IsNullOrEmpty(methodName))
                return CommandResult.Fail("'methodName' is required.");

            Type type = ComponentOps.ResolveType(typeName);
            if (type == null)
                return CommandResult.Fail($"Type not found: {typeName}");

            List<object> rawArgs = null;
            if (args.TryGetValue("args", out object argsObj) && argsObj is List<object> argList)
            {
                rawArgs = argList;
            }

            BindingFlags flags = BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic;
            MethodInfo method = ResolveStaticMethod(type, methodName, flags, rawArgs?.Count ?? 0);
            if (method == null)
                return CommandResult.Fail($"Static method '{methodName}' not found on type '{typeName}'" +
                    (rawArgs != null ? $" (looked for arity {rawArgs.Count})" : "") + ".");

            if (!method.IsStatic)
                return CommandResult.Fail($"Method '{methodName}' on type '{typeName}' is not static.");

            object[] methodArgs;
            try
            {
                methodArgs = CoerceArguments(method, rawArgs);
            }
            catch (Exception ex)
            {
                return CommandResult.Fail($"Failed to coerce arguments for {typeName}.{methodName}: {ex.Message}");
            }

            try
            {
                object result = method.Invoke(null, methodArgs);

                var json = SimpleJson.Object()
                    .Put("executed", true)
                    .Put("typeName", typeName)
                    .Put("methodName", methodName);

                if (result != null)
                    json.Put("result", result.ToString());
                else
                    json.PutNull("result");

                return CommandResult.Ok(json.ToString());
            }
            catch (TargetInvocationException ex)
            {
                return CommandResult.Fail($"Method threw exception: {ex.InnerException?.Message ?? ex.Message}");
            }
            catch (Exception ex)
            {
                return CommandResult.Fail($"Failed to invoke method: {ex.Message}");
            }
        }

        static string TryRedirectPlayMenu(string menuItem)
        {
            if (string.IsNullOrEmpty(menuItem)) return null;
            string m = menuItem.Trim();
            if (string.Equals(m, "Edit/Play", StringComparison.OrdinalIgnoreCase)) return "toggle";
            if (string.Equals(m, "Edit/Pause", StringComparison.OrdinalIgnoreCase)) return "toggle-pause";
            // Edit/Step has no PlayModeOps equivalent — fall through (agent can pivot to manual pause/unpause).
            return null;
        }

        static MethodInfo ResolveStaticMethod(Type type, string name, BindingFlags flags, int arity)
        {
            MethodInfo best = null;
            foreach (var m in type.GetMethods(flags))
            {
                if (m.Name != name) continue;
                var ps = m.GetParameters();
                if (ps.Length == arity) { best = m; break; }
                if (best == null) best = m;
            }
            return best;
        }

        static object[] CoerceArguments(MethodInfo method, List<object> rawArgs)
        {
            var ps = method.GetParameters();
            var result = new object[ps.Length];
            for (int i = 0; i < ps.Length; i++)
            {
                object raw = (rawArgs != null && i < rawArgs.Count) ? rawArgs[i] : Type.Missing;
                if (raw == Type.Missing)
                {
                    if (ps[i].HasDefaultValue) result[i] = ps[i].DefaultValue;
                    else throw new ArgumentException($"missing arg [{i}] for parameter '{ps[i].Name}' ({ps[i].ParameterType.Name})");
                    continue;
                }
                result[i] = CoerceValue(raw, ps[i].ParameterType, $"[{i}] {ps[i].Name}");
            }
            return result;
        }

        static object CoerceValue(object raw, Type target, string ctx)
        {
            if (raw == null)
            {
                if (target.IsValueType && Nullable.GetUnderlyingType(target) == null)
                    throw new ArgumentException($"{ctx}: null cannot bind to value type {target.Name}");
                return null;
            }
            if (target.IsInstanceOfType(raw)) return raw;

            if (target.IsArray && raw is List<object> rawList)
            {
                Type elemType = target.GetElementType();
                var arr = Array.CreateInstance(elemType, rawList.Count);
                for (int j = 0; j < rawList.Count; j++)
                    arr.SetValue(CoerceValue(rawList[j], elemType, $"{ctx}[{j}]"), j);
                return arr;
            }

            if (target.IsEnum)
            {
                if (raw is string s) return Enum.Parse(target, s, ignoreCase: true);
                return Enum.ToObject(target, Convert.ChangeType(raw, Enum.GetUnderlyingType(target), CultureInfo.InvariantCulture));
            }

            try
            {
                return Convert.ChangeType(raw, target, CultureInfo.InvariantCulture);
            }
            catch (Exception ex)
            {
                throw new ArgumentException($"{ctx}: cannot coerce {raw.GetType().Name} '{raw}' to {target.Name} ({ex.Message})");
            }
        }
    }
}
