using System;
using System.Collections.Generic;
using System.Reflection;
using UnityEditor;
using UnityEngine;

namespace Dreamer.AgentBridge
{
    public static class EditorOps
    {
        /// <summary>
        /// Execute a Unity Editor menu item.
        /// Args: { menuItem: "GameObject/UI/Canvas" }
        /// </summary>
        public static CommandResult ExecuteMenuItem(Dictionary<string, object> args)
        {
            string menuItem = SimpleJson.GetString(args, "menuItem");
            if (string.IsNullOrEmpty(menuItem))
                return CommandResult.Fail("'menuItem' is required.");

            // Validate the menu item exists by checking if it's enabled
            // EditorApplication.ExecuteMenuItem returns false if the item doesn't exist
            bool executed = EditorApplication.ExecuteMenuItem(menuItem);
            if (!executed)
                return CommandResult.Fail($"Menu item not found or not executable: {menuItem}");

            var json = SimpleJson.Object()
                .Put("executed", true)
                .Put("menuItem", menuItem)
                .ToString();

            return CommandResult.Ok(json);
        }

        /// <summary>
        /// Execute a static method via reflection. Advanced use only.
        /// Args: { typeName: "UnityEditor.SceneView", methodName: "RepaintAll", args?: [...] }
        /// </summary>
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

            // Collect method arguments if provided
            object[] methodArgs = null;
            if (args.TryGetValue("args", out object argsObj) && argsObj is List<object> argList)
            {
                methodArgs = argList.ToArray();
            }

            BindingFlags flags = BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic;
            MethodInfo method = null;

            if (methodArgs == null || methodArgs.Length == 0)
            {
                method = type.GetMethod(methodName, flags, null, Type.EmptyTypes, null);
                // Fallback: find any static method with that name
                if (method == null)
                    method = type.GetMethod(methodName, flags);
            }
            else
            {
                // Try to find a matching method by name (parameter type matching is best-effort)
                method = type.GetMethod(methodName, flags);
            }

            if (method == null)
                return CommandResult.Fail($"Static method '{methodName}' not found on type '{typeName}'.");

            if (!method.IsStatic)
                return CommandResult.Fail($"Method '{methodName}' on type '{typeName}' is not static.");

            try
            {
                object result = method.Invoke(null, methodArgs ?? new object[0]);

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
    }
}
