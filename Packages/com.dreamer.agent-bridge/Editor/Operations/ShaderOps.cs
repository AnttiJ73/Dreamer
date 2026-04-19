using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEngine;

namespace Dreamer.AgentBridge
{
    /// <summary>
    /// Shader-specific queries. These are diagnostics — there is no
    /// `create_shader` or `set_shader_code` command because agents write
    /// .shader source files directly to disk via their own file tools
    /// (same as .cs), then `refresh-assets` picks them up.
    /// </summary>
    public static class ShaderOps
    {
        // ── shader-status ────────────────────────────────────────────────

        /// <summary>
        /// Report shader compile errors/warnings via ShaderUtil.GetShaderMessages.
        /// Args:
        ///   { assetPath?: "Assets/Shaders/Foo.shader", guid?: "..." }
        ///     → single shader report
        ///   {} or { scanProject: true }
        ///     → scan every shader under Assets/; report any with messages.
        ///
        /// Result fields: `status` ("ok" | "warnings" | "errors"), `messages[]`
        /// with per-message severity/text/platform/file/line. For project
        /// scans, also `shadersWithErrors[]` / `shadersWithWarnings[]`.
        /// </summary>
        public static CommandResult ShaderStatus(Dictionary<string, object> args)
        {
            string assetPath = args.ContainsKey("assetPath") || args.ContainsKey("guid")
                ? AssetOps.ResolveAssetPath(args)
                : null;

            if (!string.IsNullOrEmpty(assetPath))
            {
                return ReportSingleShader(assetPath);
            }

            return ReportProjectScan();
        }

        static CommandResult ReportSingleShader(string assetPath)
        {
            var shader = AssetDatabase.LoadAssetAtPath<Shader>(assetPath);
            if (shader == null)
                return CommandResult.Fail($"Asset at '{assetPath}' is not a Shader.");

            var msgs = ShaderUtil.GetShaderMessages(shader);
            int errors = 0, warnings = 0;
            foreach (var m in msgs)
            {
                if (m.severity == UnityEditor.Rendering.ShaderCompilerMessageSeverity.Error) errors++;
                else if (m.severity == UnityEditor.Rendering.ShaderCompilerMessageSeverity.Warning) warnings++;
            }

            string status = errors > 0 ? "errors" : (warnings > 0 ? "warnings" : "ok");

            return CommandResult.Ok(SimpleJson.Object()
                .Put("status", status)
                .Put("assetPath", assetPath)
                .Put("guid", AssetDatabase.AssetPathToGUID(assetPath))
                .Put("shader", shader.name)
                .Put("errorCount", errors)
                .Put("warningCount", warnings)
                .PutRaw("messages", BuildMessagesJson(msgs))
                .ToString());
        }

        static CommandResult ReportProjectScan()
        {
            string[] guids = AssetDatabase.FindAssets("t:Shader");
            var shadersWithErrors = new List<string>();
            var shadersWithWarnings = new List<string>();
            int totalErrors = 0, totalWarnings = 0;
            int scanned = 0;

            var perShader = SimpleJson.Array();
            foreach (var guid in guids)
            {
                string path = AssetDatabase.GUIDToAssetPath(guid);
                // Skip anything outside Assets/ (package shaders are usually fine;
                // we care about user shaders).
                if (!path.StartsWith("Assets/", StringComparison.OrdinalIgnoreCase)) continue;
                var shader = AssetDatabase.LoadAssetAtPath<Shader>(path);
                if (shader == null) continue;
                scanned++;

                var msgs = ShaderUtil.GetShaderMessages(shader);
                if (msgs == null || msgs.Length == 0) continue;

                int errs = 0, warns = 0;
                foreach (var m in msgs)
                {
                    if (m.severity == UnityEditor.Rendering.ShaderCompilerMessageSeverity.Error) errs++;
                    else if (m.severity == UnityEditor.Rendering.ShaderCompilerMessageSeverity.Warning) warns++;
                }
                totalErrors += errs;
                totalWarnings += warns;
                if (errs > 0) shadersWithErrors.Add(path);
                else if (warns > 0) shadersWithWarnings.Add(path);

                perShader.AddRaw(SimpleJson.Object()
                    .Put("assetPath", path)
                    .Put("shader", shader.name)
                    .Put("errorCount", errs)
                    .Put("warningCount", warns)
                    .PutRaw("messages", BuildMessagesJson(msgs))
                    .ToString());
            }

            string status = totalErrors > 0 ? "errors" : (totalWarnings > 0 ? "warnings" : "ok");
            return CommandResult.Ok(SimpleJson.Object()
                .Put("status", status)
                .Put("scanned", scanned)
                .Put("totalErrors", totalErrors)
                .Put("totalWarnings", totalWarnings)
                .Put("shadersWithErrors", shadersWithErrors.ToArray())
                .Put("shadersWithWarnings", shadersWithWarnings.ToArray())
                .PutRaw("reports", perShader.ToString())
                .ToString());
        }

        static string BuildMessagesJson(UnityEditor.Rendering.ShaderMessage[] msgs)
        {
            if (msgs == null || msgs.Length == 0) return "[]";
            var arr = SimpleJson.Array();
            foreach (var m in msgs)
            {
                arr.AddRaw(SimpleJson.Object()
                    .Put("severity", m.severity.ToString())
                    .Put("message", m.message)
                    .Put("messageDetails", m.messageDetails ?? "")
                    .Put("file", m.file ?? "")
                    .Put("line", m.line)
                    .Put("platform", m.platform.ToString())
                    .ToString());
            }
            return arr.ToString();
        }

        // ── inspect-shader ───────────────────────────────────────────────

        /// <summary>
        /// Describe a shader's declared interface: properties (names, types,
        /// display names, ranges), any errors/warnings, render queue,
        /// subshader LOD. Use to discover valid property names before
        /// calling set-material-property.
        /// Args: { assetPath?: "Assets/Shaders/Foo.shader", guid?: "..." } OR
        ///       { shader: "Universal Render Pipeline/Lit" } (by name)
        /// </summary>
        public static CommandResult InspectShader(Dictionary<string, object> args)
        {
            Shader shader = null;
            string assetPath = null;

            string shaderName = SimpleJson.GetString(args, "shader");
            if (!string.IsNullOrEmpty(shaderName))
            {
                shader = Shader.Find(shaderName);
                if (shader == null)
                    return CommandResult.Fail($"Shader '{shaderName}' not found (Shader.Find returned null).");
                assetPath = AssetDatabase.GetAssetPath(shader);
            }
            else
            {
                assetPath = AssetOps.ResolveAssetPath(args);
                if (assetPath == null)
                    return CommandResult.Fail("Provide 'shader' (by name), 'assetPath', or 'guid'.");
                shader = AssetDatabase.LoadAssetAtPath<Shader>(assetPath);
                if (shader == null)
                    return CommandResult.Fail($"Asset at '{assetPath}' is not a Shader.");
            }

            var props = SimpleJson.Array();
            int count = ShaderUtil.GetPropertyCount(shader);
            for (int i = 0; i < count; i++)
            {
                string pname = ShaderUtil.GetPropertyName(shader, i);
                string display = ShaderUtil.GetPropertyDescription(shader, i);
                var kind = ShaderUtil.GetPropertyType(shader, i);

                var entry = SimpleJson.Object()
                    .Put("name", pname)
                    .Put("displayName", display)
                    .Put("type", kind.ToString())
                    .Put("hidden", ShaderUtil.IsShaderPropertyHidden(shader, i));

                if (kind == ShaderUtil.ShaderPropertyType.Range)
                {
                    entry.Put("rangeMin", ShaderUtil.GetRangeLimits(shader, i, 1));
                    entry.Put("rangeMax", ShaderUtil.GetRangeLimits(shader, i, 2));
                    entry.Put("rangeDefault", ShaderUtil.GetRangeLimits(shader, i, 0));
                }

                props.AddRaw(entry.ToString());
            }

            // Include any existing compile messages for convenience.
            var msgs = ShaderUtil.GetShaderMessages(shader);

            var json = SimpleJson.Object()
                .Put("shader", shader.name)
                .Put("assetPath", assetPath)
                .Put("renderQueue", shader.renderQueue)
                .Put("maximumLOD", shader.maximumLOD)
                .Put("isSupported", shader.isSupported)
                .PutRaw("properties", props.ToString())
                .PutRaw("messages", BuildMessagesJson(msgs))
                .ToString();
            return CommandResult.Ok(json);
        }
    }
}
