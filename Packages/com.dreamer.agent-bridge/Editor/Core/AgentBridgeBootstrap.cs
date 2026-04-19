using System;
using UnityEditor;
using UnityEngine;

namespace Dreamer.AgentBridge
{
    /// <summary>
    /// Entry point for the Agent Bridge. Starts after every domain reload
    /// via [InitializeOnLoad].
    ///
    /// Communication runs on a background thread (BackgroundBridge) so it
    /// works even when Unity is unfocused on Windows. Command execution
    /// runs on the main thread via EditorApplication.update.
    /// </summary>
    [InitializeOnLoad]
    public static class AgentBridgeBootstrap
    {
        const string PrefEnabled = "AgentBridge_Enabled";
        const double StateSnapshotIntervalSec = 2.0;
        const double PortRecheckIntervalSec = 3.0;

        static double _lastStateSnapshot;
        static double _lastPortRecheck;
        static bool _running;

        public static bool IsEnabled
        {
            get => EditorPrefs.GetBool(PrefEnabled, true);
            set
            {
                EditorPrefs.SetBool(PrefEnabled, value);
                if (value) Start();
                else Stop();
            }
        }

        public static bool IsRunning => _running;

        // ── Static constructor (runs after every domain reload) ──

        static AgentBridgeBootstrap()
        {
            EditorApplication.delayCall += OnDelayedInit;
        }

        [InitializeOnLoadMethod]
        static void InitOnLoad() { }

        static void OnDelayedInit()
        {
            if (IsEnabled)
                Start();
        }

        // ── Lifecycle ──

        public static void Start()
        {
            if (_running) return;
            _running = true;

            CompilationMonitor.Initialize();
            ConsoleCapture.Initialize();
            CommandDispatcher.Initialize();

            // Start background bridge (heartbeat + polling on thread pool)
            BackgroundBridge.Start(DaemonClient.BaseUrl);

            // Main thread update for command execution and state snapshots
            EditorApplication.update += OnUpdate;
            EditorApplication.quitting += OnQuit;

            _lastStateSnapshot = EditorApplication.timeSinceStartup;

            if (DaemonClient.HasRegistryEntry)
            {
                DreamerLog.Info($"Started. Daemon URL: {DaemonClient.BaseUrl} (from projects registry).");
            }
            else
            {
                // Bridge still starts so it can connect if a daemon happens to be on
                // the fallback port, but warn loudly: without a registry entry the
                // project relies on EditorPrefs/default 18710, which conflicts with
                // any other Unity editor also defaulting to 18710.
                string projectRoot = ProjectRegistry.GetCurrentProjectRoot();
                DreamerLog.Warn(
                    $"Started on fallback port {DaemonClient.Port} for {projectRoot} — this project is NOT registered. " +
                    $"Run `./bin/dreamer status` from the project root to register. Registry file: {DaemonClient.RegistryPath}");
            }
        }

        public static void Stop()
        {
            if (!_running) return;
            _running = false;

            EditorApplication.update -= OnUpdate;
            EditorApplication.quitting -= OnQuit;

            BackgroundBridge.Stop();
            DaemonClient.Shutdown();
            CompilationMonitor.Shutdown();
            ConsoleCapture.Shutdown();

            DreamerLog.Info("Stopped.");
        }

        // ── Menu items ──

        [MenuItem("Tools/Dreamer/Toggle Bridge")]
        static void ToggleMenu()
        {
            IsEnabled = !IsEnabled;
            DreamerLog.Info($"Bridge {(IsEnabled ? "enabled" : "disabled")}.");
        }

        [MenuItem("Tools/Dreamer/Toggle Bridge", true)]
        static bool ToggleMenuValidate()
        {
            Menu.SetChecked("Tools/Dreamer/Toggle Bridge", IsEnabled);
            return true;
        }

        // ── Update loop (main thread only) ──

        static void OnUpdate()
        {
            if (!_running) return;

            // Process commands received by BackgroundBridge (must run on main thread)
            int processed = 0;
            while (processed < 5 && BackgroundBridge.TryDequeueCommand(out var cmd))
            {
                ExecuteCommand(cmd);
                processed++;
            }

            // Periodically build and push a state snapshot for the background bridge to send
            double now = EditorApplication.timeSinceStartup;
            if (now - _lastStateSnapshot >= StateSnapshotIntervalSec)
            {
                _lastStateSnapshot = now;
                PushStateSnapshot();
            }

            // Periodically re-check the registered port so `./bin/dreamer registry
            // reassign` takes effect on a running editor without needing a full
            // Unity restart. DaemonClient.Port itself handles mtime-based cache
            // invalidation; we just poke it and forward any change to the bridge.
            if (now - _lastPortRecheck >= PortRecheckIntervalSec)
            {
                _lastPortRecheck = now;
                BackgroundBridge.UpdateBaseUrl(DaemonClient.BaseUrl);
            }
        }

        static void ExecuteCommand(BridgeCommand cmd)
        {
            if (cmd == null || string.IsNullOrEmpty(cmd.id)) return;

            try
            {
                var result = CommandDispatcher.Dispatch(cmd);
                BackgroundBridge.ReportResult(cmd.id, result.success, result.resultJson, result.error);
            }
            catch (Exception ex)
            {
                DreamerLog.Warn($"Unhandled error executing '{cmd.kind}': {ex.Message}");
                BackgroundBridge.ReportResult(cmd.id, false, null, $"Unhandled error: {ex.Message}");
            }
        }

        static void PushStateSnapshot()
        {
            var consoleEntries = ConsoleCapture.GetEntries(20);

            var consoleArr = SimpleJson.Array();
            if (consoleEntries != null)
            {
                foreach (var entry in consoleEntries)
                {
                    consoleArr.AddRaw(SimpleJson.Object()
                        .Put("message", entry.message ?? "")
                        .Put("type", entry.type ?? "Log")
                        .Put("timestamp", entry.timestamp ?? "")
                        .ToString());
                }
            }

            string projectPath = System.IO.Path.GetDirectoryName(Application.dataPath);

            var json = SimpleJson.Object()
                .Put("compiling", CompilationMonitor.IsCompiling || EditorApplication.isCompiling)
                .Put("compileErrors", CompilationMonitor.GetErrorArray())
                .Put("playMode", EditorApplication.isPlaying)
                .Put("projectPath", projectPath)
                .PutRaw("recentConsole", consoleArr.ToString())
                .ToString();

            BackgroundBridge.SetStateSnapshot(json);
        }

        static void OnQuit()
        {
            Stop();
        }
    }
}
