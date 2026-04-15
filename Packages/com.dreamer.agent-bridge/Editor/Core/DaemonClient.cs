using System;
using System.Collections.Generic;
using System.Text;
using UnityEditor;
using UnityEngine;
using UnityEngine.Networking;

namespace Dreamer.AgentBridge
{
    /// <summary>
    /// HTTP client for daemon communication. Uses UnityWebRequest,
    /// driven from EditorApplication.update.
    /// </summary>
    public static class DaemonClient
    {
        const string PrefPort = "AgentBridge_Port";
        const int DefaultPort = 18710;
        const int MaxConcurrentRequests = 4;

        static readonly List<InFlightRequest> _inFlight = new List<InFlightRequest>();
        static readonly Queue<QueuedRequest> _outgoing = new Queue<QueuedRequest>();

        static bool _suppressErrors;
        static int _consecutiveErrors;
        const int ErrorSuppressThreshold = 3;

        // Port cache — refreshed on domain reload (static state resets), which
        // is when the user most likely changed config. Avoids file I/O on every
        // HTTP request.
        static int? _cachedConfigPort;

        // ── Public API ──

        /// <summary>
        /// Daemon port. Precedence:
        ///   DREAMER_PORT env var > daemon/.dreamer-config.json > EditorPrefs > 18710.
        /// Reading from the per-project config file keeps multiple Unity projects
        /// on distinct ports without relying on the (machine-global) EditorPrefs.
        /// </summary>
        public static int Port
        {
            get
            {
                string envPort = Environment.GetEnvironmentVariable("DREAMER_PORT");
                if (!string.IsNullOrEmpty(envPort) && int.TryParse(envPort, out int p)) return p;

                int configPort = ReadConfigPort();
                if (configPort > 0) return configPort;

                return EditorPrefs.GetInt(PrefPort, DefaultPort);
            }
            set => EditorPrefs.SetInt(PrefPort, value);
        }

        static int ReadConfigPort()
        {
            if (_cachedConfigPort.HasValue) return _cachedConfigPort.Value;
            int result = -1;
            try
            {
                // Application.dataPath is <project>/Assets — parent is the project root.
                string projectRoot = System.IO.Path.GetDirectoryName(Application.dataPath);
                string configPath = System.IO.Path.Combine(projectRoot, "daemon", ".dreamer-config.json");
                if (System.IO.File.Exists(configPath))
                {
                    string json = System.IO.File.ReadAllText(configPath);
                    // Narrow regex — config is machine-written, always simple key:value.
                    var match = System.Text.RegularExpressions.Regex.Match(json, "\"port\"\\s*:\\s*(\\d+)");
                    if (match.Success && int.TryParse(match.Groups[1].Value, out int p) && p > 0)
                    {
                        result = p;
                    }
                }
            }
            catch { /* treat as missing */ }
            _cachedConfigPort = result;
            return result;
        }

        /// <summary>Force a re-read of the config port on next access (call after editing config).</summary>
        public static void InvalidatePortCache() => _cachedConfigPort = null;

        public static string BaseUrl => $"http://localhost:{Port}";

        public static bool IsRequestInFlight => _inFlight.Count > 0;

        public static bool HasPendingPoll
        {
            get
            {
                foreach (var r in _inFlight)
                    if (r.tag == "poll") return true;
                return false;
            }
        }

        /// <summary>Call from EditorApplication.update to pump request queue.</summary>
        public static void Update()
        {
            // Check completed requests
            for (int i = _inFlight.Count - 1; i >= 0; i--)
            {
                var req = _inFlight[i];
                if (!req.www.isDone) continue;

                _inFlight.RemoveAt(i);

                bool isError = req.www.result == UnityWebRequest.Result.ConnectionError
                            || req.www.result == UnityWebRequest.Result.ProtocolError
                            || req.www.result == UnityWebRequest.Result.DataProcessingError;

                if (isError)
                {
                    _consecutiveErrors++;
                    if (_consecutiveErrors <= ErrorSuppressThreshold)
                    {
                        Debug.LogWarning($"[AgentBridge] HTTP {req.www.method} {req.www.url} failed: {req.www.error}");
                    }
                    else if (_consecutiveErrors == ErrorSuppressThreshold + 1)
                    {
                        Debug.LogWarning("[AgentBridge] Suppressing further connection errors until daemon becomes available.");
                        _suppressErrors = true;
                    }
                    req.onError?.Invoke(req.www.error ?? "Unknown error");
                }
                else
                {
                    if (_suppressErrors)
                    {
                        Debug.Log("[AgentBridge] Daemon connection restored.");
                        _suppressErrors = false;
                    }
                    _consecutiveErrors = 0;
                    req.onSuccess?.Invoke(req.www.downloadHandler?.text ?? "");
                }

                req.www.Dispose();
            }

            // Dispatch queued requests
            while (_outgoing.Count > 0 && _inFlight.Count < MaxConcurrentRequests)
            {
                var q = _outgoing.Dequeue();
                var www = q.buildRequest();
                www.SendWebRequest();
                _inFlight.Add(new InFlightRequest
                {
                    www = www,
                    tag = q.tag,
                    onSuccess = q.onSuccess,
                    onError = q.onError
                });
            }
        }

        /// <summary>Fetch pending commands from daemon.</summary>
        public static void FetchPendingCommands(Action<List<BridgeCommand>> onSuccess, Action<string> onError)
        {
            if (HasPendingPoll) return; // Don't overlap polls

            Enqueue("poll", () =>
            {
                var www = UnityWebRequest.Get($"{BaseUrl}/api/unity/pending");
                www.timeout = 5;
                return www;
            },
            body =>
            {
                var commands = new List<BridgeCommand>();
                try
                {
                    var parsed = SimpleJson.Deserialize(body);
                    if (parsed.TryGetValue("commands", out object cmdsObj) && cmdsObj is List<object> cmdList)
                    {
                        foreach (var item in cmdList)
                        {
                            if (item is Dictionary<string, object> cmdDict)
                            {
                                var cmd = new BridgeCommand
                                {
                                    id = SimpleJson.GetString(cmdDict, "id", ""),
                                    kind = SimpleJson.GetString(cmdDict, "kind", ""),
                                    argsJson = ""
                                };
                                // Args can be a nested object — re-serialize it
                                if (cmdDict.TryGetValue("args", out object argsVal))
                                {
                                    if (argsVal is Dictionary<string, object>)
                                        cmd.argsJson = SimpleJson.Serialize(argsVal);
                                    else if (argsVal is string s)
                                        cmd.argsJson = s;
                                    else
                                        cmd.argsJson = SimpleJson.Serialize(argsVal);
                                }
                                commands.Add(cmd);
                            }
                        }
                    }
                }
                catch (Exception ex)
                {
                    Debug.LogWarning($"[AgentBridge] Failed to parse pending commands: {ex.Message}");
                }
                onSuccess?.Invoke(commands);
            },
            onError);
        }

        /// <summary>Report a command result to the daemon.</summary>
        public static void ReportResult(string commandId, bool success, string resultJson, string error)
        {
            var json = SimpleJson.Object()
                .Put("id", commandId)
                .Put("success", success)
                .Put("resultJson", resultJson)
                .Put("error", error)
                .ToString();

            PostJson("result", $"{BaseUrl}/api/unity/result", json, null, null);
        }

        /// <summary>Report current editor state to the daemon.</summary>
        public static void ReportState(EditorStateReport state)
        {
            var consoleArr = SimpleJson.Array();
            if (state.recentConsole != null)
            {
                foreach (var entry in state.recentConsole)
                {
                    consoleArr.AddRaw(SimpleJson.Object()
                        .Put("message", entry.message ?? "")
                        .Put("type", entry.type ?? "Log")
                        .Put("timestamp", entry.timestamp ?? "")
                        .ToString());
                }
            }

            var json = SimpleJson.Object()
                .Put("compiling", state.compiling)
                .Put("compileErrors", state.compileErrors ?? Array.Empty<string>())
                .Put("playMode", state.playMode)
                .PutRaw("recentConsole", consoleArr.ToString())
                .ToString();

            PostJson("state", $"{BaseUrl}/api/unity/state", json, null, null);
        }

        /// <summary>Send heartbeat to the daemon.</summary>
        public static void SendHeartbeat()
        {
            var json = SimpleJson.Object()
                .Put("timestamp", DateTime.UtcNow.ToString("o"))
                .Put("pid", System.Diagnostics.Process.GetCurrentProcess().Id)
                .ToString();

            PostJson("heartbeat", $"{BaseUrl}/api/unity/heartbeat", json, null, null);
        }

        /// <summary>Dispose all in-flight requests.</summary>
        public static void Shutdown()
        {
            foreach (var r in _inFlight)
            {
                try { r.www.Abort(); r.www.Dispose(); }
                catch { /* suppress */ }
            }
            _inFlight.Clear();
            _outgoing.Clear();
            _consecutiveErrors = 0;
            _suppressErrors = false;
        }

        // ── Internals ──

        static void PostJson(string tag, string url, string json, Action<string> onSuccess, Action<string> onError)
        {
            Enqueue(tag, () =>
            {
                byte[] bodyRaw = Encoding.UTF8.GetBytes(json);
                var www = new UnityWebRequest(url, "POST");
                www.uploadHandler = new UploadHandlerRaw(bodyRaw);
                www.downloadHandler = new DownloadHandlerBuffer();
                www.SetRequestHeader("Content-Type", "application/json");
                www.timeout = 5;
                return www;
            }, onSuccess, onError);
        }

        static void Enqueue(string tag, Func<UnityWebRequest> buildRequest, Action<string> onSuccess, Action<string> onError)
        {
            _outgoing.Enqueue(new QueuedRequest
            {
                tag = tag,
                buildRequest = buildRequest,
                onSuccess = onSuccess,
                onError = onError
            });
        }

        struct InFlightRequest
        {
            public UnityWebRequest www;
            public string tag;
            public Action<string> onSuccess;
            public Action<string> onError;
        }

        struct QueuedRequest
        {
            public string tag;
            public Func<UnityWebRequest> buildRequest;
            public Action<string> onSuccess;
            public Action<string> onError;
        }
    }
}
