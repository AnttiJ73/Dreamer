using System;
using System.Collections.Generic;
using System.IO;
using UnityEditor;
using UnityEngine;

namespace Dreamer.AgentBridge
{
    public static class ScriptOps
    {
        /// <summary>Create a C# script from a template. Args: { name, namespace?, template?: "monobehaviour"|"scriptableobject"|"editor"|"plain", path? }</summary>
        public static CommandResult CreateScript(Dictionary<string, object> args)
        {
            string name = SimpleJson.GetString(args, "name");
            string ns = SimpleJson.GetString(args, "namespace");
            string template = SimpleJson.GetString(args, "template", "monobehaviour").ToLowerInvariant();
            string folder = SimpleJson.GetString(args, "path", "Assets/Scripts");

            // Tolerate users passing a full file path in --path (e.g. "Assets/Scripts/Foo/Bar.cs").
            folder = (folder ?? string.Empty).Replace('\\', '/').TrimEnd('/');
            if (folder.EndsWith(".cs", StringComparison.OrdinalIgnoreCase))
            {
                string fileBase = Path.GetFileNameWithoutExtension(folder);
                string parent = Path.GetDirectoryName(folder)?.Replace('\\', '/') ?? string.Empty;

                if (string.IsNullOrEmpty(name))
                    name = fileBase;
                else if (!string.Equals(name, fileBase, StringComparison.Ordinal))
                    return CommandResult.Fail(
                        $"--path ends in '{Path.GetFileName(folder)}' but --name is '{name}'. " +
                        $"Pass --path as a folder (e.g. '{parent}'), not a file path.");

                folder = string.IsNullOrEmpty(parent) ? "Assets" : parent;
            }

            if (string.IsNullOrEmpty(name))
                return CommandResult.Fail("'name' is required.");

            name = SanitizeClassName(name);
            if (name.EndsWith(".cs", StringComparison.OrdinalIgnoreCase))
                name = name.Substring(0, name.Length - 3);

            if (string.IsNullOrEmpty(name))
                return CommandResult.Fail("Invalid script name after sanitization.");

            string fullDir = Path.GetFullPath(folder);
            if (!Directory.Exists(fullDir))
            {
                Directory.CreateDirectory(fullDir);
                AssetDatabase.Refresh();
            }

            string assetPath = $"{folder}/{name}.cs";
            string fullPath = Path.GetFullPath(assetPath);

            if (File.Exists(fullPath))
                return CommandResult.Fail($"Script already exists at: {assetPath}");

            string content = GenerateScript(name, ns, template);

            File.WriteAllText(fullPath, content, System.Text.Encoding.UTF8);
            AssetDatabase.Refresh();

            var json = SimpleJson.Object()
                .Put("path", assetPath)
                .Put("className", name)
                .Put("created", true)
                .ToString();

            return CommandResult.Ok(json);
        }

        static string GenerateScript(string className, string ns, string template)
        {
            bool hasNs = !string.IsNullOrEmpty(ns);
            string indent = hasNs ? "    " : "";
            string body;

            switch (template)
            {
                case "scriptableobject":
                case "so":
                    body = GenerateScriptableObject(className, indent);
                    break;

                case "editor":
                    body = GenerateEditor(className, indent);
                    break;

                case "plain":
                    body = GeneratePlain(className, indent);
                    break;

                case "monobehaviour":
                default:
                    body = GenerateMonoBehaviour(className, indent);
                    break;
            }

            var sb = new System.Text.StringBuilder();

            if (template == "editor")
            {
                sb.AppendLine("using UnityEngine;");
                sb.AppendLine("using UnityEditor;");
            }
            else if (template == "scriptableobject" || template == "so")
            {
                sb.AppendLine("using UnityEngine;");
            }
            else if (template == "monobehaviour")
            {
                sb.AppendLine("using UnityEngine;");
            }

            sb.AppendLine();

            if (hasNs)
            {
                sb.AppendLine($"namespace {ns}");
                sb.AppendLine("{");
            }

            sb.Append(body);

            if (hasNs)
            {
                sb.AppendLine("}");
            }

            return sb.ToString();
        }

        static string GenerateMonoBehaviour(string className, string indent)
        {
            return $@"{indent}public class {className} : MonoBehaviour
{indent}{{
{indent}    void Start()
{indent}    {{
{indent}    }}

{indent}    void Update()
{indent}    {{
{indent}    }}
{indent}}}
";
        }

        static string GenerateScriptableObject(string className, string indent)
        {
            return $@"{indent}[CreateAssetMenu(fileName = ""{className}"", menuName = ""ScriptableObjects/{className}"")]
{indent}public class {className} : ScriptableObject
{indent}{{
{indent}}}
";
        }

        static string GenerateEditor(string className, string indent)
        {
            string targetClass = className.EndsWith("Editor")
                ? className.Substring(0, className.Length - 6)
                : className.Replace("Editor", "");

            if (string.IsNullOrEmpty(targetClass))
                targetClass = "MonoBehaviour";

            return $@"{indent}// [CustomEditor(typeof({targetClass}))]
{indent}public class {className} : Editor
{indent}{{
{indent}    public override void OnInspectorGUI()
{indent}    {{
{indent}        base.OnInspectorGUI();
{indent}    }}
{indent}}}
";
        }

        static string GeneratePlain(string className, string indent)
        {
            return $@"{indent}public class {className}
{indent}{{
{indent}}}
";
        }

        static string SanitizeClassName(string name)
        {
            var sb = new System.Text.StringBuilder(name.Length);
            for (int i = 0; i < name.Length; i++)
            {
                char c = name[i];
                if (char.IsLetterOrDigit(c) || c == '_')
                {
                    // First char must be letter or underscore.
                    if (sb.Length == 0 && char.IsDigit(c))
                        sb.Append('_');
                    sb.Append(c);
                }
            }
            return sb.ToString();
        }
    }
}
