using System;
using UnityEditor;
using UnityEngine;

namespace Dreamer.AgentBridge
{
    public class AgentBridgeWindow : EditorWindow
    {
        Vector2 _scrollPos;
        int _portInput;
        bool _initialized;

        [MenuItem("Tools/Dreamer/Status")]
        static void ShowWindow()
        {
            var wnd = GetWindow<AgentBridgeWindow>();
            wnd.titleContent = new GUIContent("Dreamer");
            wnd.minSize = new Vector2(320, 400);
            wnd.Show();
        }

        void OnEnable()
        {
            _portInput = DaemonClient.Port;
            _initialized = true;
        }

        void OnGUI()
        {
            if (!_initialized)
            {
                _portInput = DaemonClient.Port;
                _initialized = true;
            }

            _scrollPos = EditorGUILayout.BeginScrollView(_scrollPos);

            DrawHeader();
            EditorGUILayout.Space(8);
            DrawConnectionSettings();
            EditorGUILayout.Space(8);
            DrawStatus();
            EditorGUILayout.Space(8);
            DrawCompilationStatus();
            EditorGUILayout.Space(8);
            DrawRecentCommands();

            EditorGUILayout.EndScrollView();

            // Auto-repaint while running
            if (AgentBridgeBootstrap.IsRunning)
                Repaint();
        }

        void DrawHeader()
        {
            EditorGUILayout.LabelField("Dreamer - Agent Bridge", EditorStyles.boldLabel);
            EditorGUILayout.Space(4);

            EditorGUI.BeginChangeCheck();
            bool enabled = EditorGUILayout.Toggle("Bridge Enabled", AgentBridgeBootstrap.IsEnabled);
            if (EditorGUI.EndChangeCheck())
            {
                AgentBridgeBootstrap.IsEnabled = enabled;
            }

            // Status indicator
            string status = AgentBridgeBootstrap.IsRunning ? "RUNNING" : "STOPPED";
            Color statusColor = AgentBridgeBootstrap.IsRunning ? new Color(0.2f, 0.8f, 0.2f) : Color.gray;

            var rect = EditorGUILayout.GetControlRect(false, 20);
            var style = new GUIStyle(EditorStyles.label)
            {
                fontStyle = FontStyle.Bold,
                alignment = TextAnchor.MiddleLeft
            };
            var prevColor = GUI.color;
            GUI.color = statusColor;
            EditorGUI.LabelField(rect, $"Status: {status}", style);
            GUI.color = prevColor;

            // Project path (helps debug multi-project setups)
            string projectPath = System.IO.Path.GetDirectoryName(Application.dataPath);
            EditorGUILayout.LabelField("Project", projectPath, EditorStyles.miniLabel);
        }

        void DrawConnectionSettings()
        {
            EditorGUILayout.LabelField("Connection", EditorStyles.boldLabel);

            using (new EditorGUI.IndentLevelScope())
            {
                EditorGUILayout.LabelField("Daemon URL", DaemonClient.BaseUrl);

                EditorGUI.BeginChangeCheck();
                _portInput = EditorGUILayout.IntField("Port", _portInput);
                if (EditorGUI.EndChangeCheck())
                {
                    if (_portInput > 0 && _portInput <= 65535)
                    {
                        DaemonClient.Port = _portInput;
                    }
                }

                EditorGUILayout.Space(4);

                EditorGUILayout.BeginHorizontal();
                if (GUILayout.Button("Reconnect", GUILayout.Width(100)))
                {
                    AgentBridgeBootstrap.Stop();
                    AgentBridgeBootstrap.Start();
                }
                if (GUILayout.Button("Refresh", GUILayout.Width(100)))
                {
                    Repaint();
                }
                EditorGUILayout.EndHorizontal();
            }
        }

        void DrawStatus()
        {
            EditorGUILayout.LabelField("Editor State", EditorStyles.boldLabel);

            using (new EditorGUI.IndentLevelScope())
            {
                EditorGUILayout.LabelField("Play Mode", EditorApplication.isPlaying ? "Playing" : "Edit Mode");
                EditorGUILayout.LabelField("Compiling", EditorApplication.isCompiling ? "Yes" : "No");
                EditorGUILayout.LabelField("HTTP Requests In Flight", DaemonClient.IsRequestInFlight ? "Yes" : "No");
            }
        }

        void DrawCompilationStatus()
        {
            EditorGUILayout.LabelField("Compilation", EditorStyles.boldLabel);

            using (new EditorGUI.IndentLevelScope())
            {
                EditorGUILayout.LabelField("Is Compiling", CompilationMonitor.IsCompiling ? "Yes" : "No");
                EditorGUILayout.LabelField("Last Compile Succeeded",
                    CompilationMonitor.LastCompileTime.HasValue
                        ? (CompilationMonitor.LastCompileSucceeded ? "Yes" : "No")
                        : "N/A");

                if (CompilationMonitor.LastCompileTime.HasValue)
                    EditorGUILayout.LabelField("Last Compile Time",
                        CompilationMonitor.LastCompileTime.Value.ToLocalTime().ToString("HH:mm:ss"));

                var errors = CompilationMonitor.CompileErrors;
                if (errors.Count > 0)
                {
                    EditorGUILayout.Space(4);
                    EditorGUILayout.LabelField($"Compile Errors ({errors.Count}):", EditorStyles.miniLabel);
                    for (int i = 0; i < Math.Min(errors.Count, 5); i++)
                    {
                        EditorGUILayout.HelpBox(errors[i], MessageType.Error);
                    }
                    if (errors.Count > 5)
                        EditorGUILayout.LabelField($"...and {errors.Count - 5} more", EditorStyles.miniLabel);
                }
            }
        }

        void DrawRecentCommands()
        {
            EditorGUILayout.LabelField("Recent Commands", EditorStyles.boldLabel);

            var commands = CommandDispatcher.RecentCommands;
            if (commands.Count == 0)
            {
                using (new EditorGUI.IndentLevelScope())
                    EditorGUILayout.LabelField("No commands executed yet.", EditorStyles.miniLabel);
                return;
            }

            int shown = Math.Min(commands.Count, 10);
            for (int i = 0; i < shown; i++)
            {
                var cmd = commands[i];
                string icon = cmd.success ? "\u2713" : "\u2717";
                string time = cmd.startTime.ToLocalTime().ToString("HH:mm:ss");
                double duration = (cmd.endTime - cmd.startTime).TotalMilliseconds;

                using (new EditorGUI.IndentLevelScope())
                {
                    var label = $"{icon} [{time}] {cmd.kind} ({duration:F0}ms)";
                    if (!cmd.success && !string.IsNullOrEmpty(cmd.error))
                        label += $" - {cmd.error}";

                    var style = new GUIStyle(EditorStyles.miniLabel)
                    {
                        wordWrap = true,
                        richText = false
                    };
                    style.normal.textColor = cmd.success
                        ? EditorStyles.label.normal.textColor
                        : new Color(1f, 0.4f, 0.4f);

                    EditorGUILayout.LabelField(label, style);
                }
            }

            if (commands.Count > shown)
            {
                using (new EditorGUI.IndentLevelScope())
                    EditorGUILayout.LabelField($"...and {commands.Count - shown} more", EditorStyles.miniLabel);
            }
        }
    }
}
