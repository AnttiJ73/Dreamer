using System;
using System.Collections.Generic;
using System.IO;
using UnityEngine;

namespace Dreamer.AgentBridge
{
    /// <summary>Read-only accessor for the shared projects registry written by the daemon (daemon/src/project-registry.js). The bridge never writes this file.</summary>
    public static class ProjectRegistry
    {
        /// <summary>Registry file path for the current OS. Windows: %APPDATA%/Dreamer/projects.json. Unix: $HOME/.dreamer/projects.json.</summary>
        public static string GetRegistryPath()
        {
            // Test/dev override matches the Node side.
            string env = Environment.GetEnvironmentVariable("DREAMER_REGISTRY_PATH");
            if (!string.IsNullOrEmpty(env)) return env;

            string baseDir;
            if (Application.platform == RuntimePlatform.WindowsEditor)
            {
                baseDir = Environment.GetEnvironmentVariable("APPDATA");
                if (string.IsNullOrEmpty(baseDir))
                    baseDir = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
                return Path.Combine(baseDir, "Dreamer", "projects.json");
            }

            string home = Environment.GetEnvironmentVariable("HOME");
            if (string.IsNullOrEmpty(home)) home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            return Path.Combine(home, ".dreamer", "projects.json");
        }

        /// <summary>Canonical registry-key form — must match the Node normalizer (forward slashes, no trailing slash, lowercase on Windows).</summary>
        public static string NormalizeProjectPath(string path)
        {
            if (string.IsNullOrEmpty(path)) return null;
            string n = path.Replace('\\', '/').TrimEnd('/');
            if (Application.platform == RuntimePlatform.WindowsEditor)
                n = n.ToLowerInvariant();
            return n;
        }

        /// <summary>Unity project root — parent of Application.dataPath.</summary>
        public static string GetCurrentProjectRoot()
        {
            return Path.GetDirectoryName(Application.dataPath);
        }

        /// <summary>Port registered for the current project, or -1.</summary>
        public static int GetPortForCurrentProject()
        {
            return GetPortForProject(GetCurrentProjectRoot());
        }

        /// <summary>Port registered for any project path, or -1.</summary>
        public static int GetPortForProject(string projectPath)
        {
            var entry = GetEntryForProject(projectPath);
            if (entry == null) return -1;
            if (entry.TryGetValue("port", out object portObj))
            {
                if (portObj is int i) return i;
                if (portObj is long l) return (int)l;
                if (portObj is double d) return (int)d;
                if (portObj is string s && int.TryParse(s, out int p)) return p;
            }
            return -1;
        }

        /// <summary>Registry entry dictionary for a project, or null. Exposed so callers can read daemonPid / lastStartedAt.</summary>
        public static Dictionary<string, object> GetEntryForProject(string projectPath)
        {
            string key = NormalizeProjectPath(projectPath);
            if (string.IsNullOrEmpty(key)) return null;

            Dictionary<string, object> reg;
            try
            {
                string path = GetRegistryPath();
                if (!File.Exists(path)) return null;
                string json = File.ReadAllText(path);
                reg = SimpleJson.Deserialize(json);
            }
            catch
            {
                return null;
            }

            if (reg == null) return null;
            if (!reg.TryGetValue("projects", out object projObj)) return null;
            if (!(projObj is Dictionary<string, object> projects)) return null;
            if (!projects.TryGetValue(key, out object entryObj)) return null;
            return entryObj as Dictionary<string, object>;
        }

        /// <summary>True if an entry exists for the current project.</summary>
        public static bool IsCurrentProjectRegistered()
        {
            return GetPortForCurrentProject() > 0;
        }
    }
}
