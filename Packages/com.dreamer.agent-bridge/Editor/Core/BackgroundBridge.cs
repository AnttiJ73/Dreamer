using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Text;
using System.Threading;
using UnityEngine;

namespace Dreamer.AgentBridge
{
    /// <summary>
    /// Background-thread HTTP bridge that works even when Unity is unfocused.
    /// Handles heartbeat, state reporting, command polling, and result reporting
    /// without depending on EditorApplication.update ticking.
    /// </summary>
    public static class BackgroundBridge
    {
        static Timer _heartbeatTimer;
        static Timer _pollTimer;
        static Timer _stateTimer;

        static readonly ConcurrentQueue<BridgeCommand> _incomingCommands = new ConcurrentQueue<BridgeCommand>();
        static volatile bool _running;
        static string _baseUrl;

        // Project root this Unity Editor has open. Captured on Start from the main
        // thread (Application.dataPath is not safe to call from background threads).
        static string _projectPath;

        // State snapshot (set from main thread, read from background thread)
        static volatile string _pendingStateJson;

        // Suppress error logging after repeated failures
        static int _consecutiveErrors;
        const int ErrorLogThreshold = 3;

        public static bool IsRunning => _running;

        /// <summary>Start background polling and heartbeat.</summary>
        public static void Start(string baseUrl)
        {
            if (_running) return;
            _running = true;
            _baseUrl = baseUrl;
            _consecutiveErrors = 0;

            // Capture project root from main thread — Application.dataPath is "<project>/Assets".
            try { _projectPath = System.IO.Path.GetDirectoryName(Application.dataPath); }
            catch { _projectPath = null; }

            // Heartbeat every 3s, start immediately
            _heartbeatTimer = new Timer(HeartbeatTick, null, 0, 3000);

            // Poll for commands every 250ms, start after 500ms
            _pollTimer = new Timer(PollTick, null, 500, 250);

            // State reporting every 2s, start after 1s
            _stateTimer = new Timer(StateTick, null, 1000, 2000);
        }

        /// <summary>Stop all background activity.</summary>
        public static void Stop()
        {
            _running = false;
            _heartbeatTimer?.Change(Timeout.Infinite, Timeout.Infinite);
            _pollTimer?.Change(Timeout.Infinite, Timeout.Infinite);
            _stateTimer?.Change(Timeout.Infinite, Timeout.Infinite);
            _heartbeatTimer?.Dispose();
            _pollTimer?.Dispose();
            _stateTimer?.Dispose();
            _heartbeatTimer = null;
            _pollTimer = null;
            _stateTimer = null;

            // Drain command queue
            while (_incomingCommands.TryDequeue(out _)) { }
        }

        /// <summary>Try to dequeue a command received from the daemon. Called from main thread.</summary>
        public static bool TryDequeueCommand(out BridgeCommand cmd)
        {
            return _incomingCommands.TryDequeue(out cmd);
        }

        /// <summary>Set the state JSON to be sent on the next state tick. Called from main thread.</summary>
        public static void SetStateSnapshot(string json)
        {
            _pendingStateJson = json;
        }

        /// <summary>
        /// Update the base URL used for subsequent HTTP calls. Called from main
        /// thread when the resolved daemon port changes (e.g. after the user
        /// runs `./bin/dreamer registry reassign`). Without this, the bridge
        /// keeps hammering the old port until Unity restarts.
        /// </summary>
        public static void UpdateBaseUrl(string baseUrl)
        {
            if (string.IsNullOrEmpty(baseUrl) || baseUrl == _baseUrl) return;
            DreamerLog.Info($"Daemon URL changed: {_baseUrl} → {baseUrl}");
            _baseUrl = baseUrl;
            _consecutiveErrors = 0;
        }

        /// <summary>Report a command result to the daemon. Thread-safe — runs on thread pool.</summary>
        public static void ReportResult(string commandId, bool success, string resultJson, string error)
        {
            if (!_running) return;
            ThreadPool.QueueUserWorkItem(_ =>
            {
                try
                {
                    var json = SimpleJson.Object()
                        .Put("id", commandId)
                        .Put("success", success)
                        .Put("resultJson", resultJson)
                        .Put("error", error)
                        .ToString();
                    HttpPost($"{_baseUrl}/api/unity/result", json);
                }
                catch { /* swallow — result reporting is best-effort */ }
            });
        }

        // ── Timer callbacks (run on thread pool threads) ──

        static void HeartbeatTick(object state)
        {
            if (!_running) return;
            try
            {
                var body = SimpleJson.Object()
                    .Put("timestamp", DateTime.UtcNow.ToString("o"))
                    .Put("pid", System.Diagnostics.Process.GetCurrentProcess().Id);
                if (!string.IsNullOrEmpty(_projectPath))
                {
                    body.Put("projectPath", _projectPath);
                }

                // Piggyback a minimal state snapshot on every heartbeat so the daemon's
                // `hasReceivedState` flag flips even when Unity's main thread isn't
                // ticking (Windows + unfocused editor, e.g.). Without this, a fresh
                // daemon would deadlock all compile-gated commands until the user
                // focuses Unity, which is exactly the failure we want to avoid.
                // These fields are safe to read from background threads — the
                // static flag is a plain bool, error snapshot is copy-on-read.
                body.Put("compiling", CompilationMonitor.IsCompiling);
                body.Put("compileErrors", CompilationMonitor.GetErrorArray());

                // Also report Unity's memory of the last compile outcome. When
                // the daemon restarts after Unity has been running for a while,
                // this lets it restore `lastCompileSuccess` instead of showing
                // `idle` until the next compile cycle fires.
                if (CompilationMonitor.LastCompileTime.HasValue)
                {
                    body.Put("lastCompileTime", CompilationMonitor.LastCompileTime.Value.ToString("o"));
                    body.Put("lastCompileSucceeded", CompilationMonitor.LastCompileSucceeded);
                }

                HttpPost($"{_baseUrl}/api/unity/heartbeat", body.ToString());
                OnSuccess();
            }
            catch (Exception ex)
            {
                OnError(ex);
            }
        }

        static void PollTick(object state)
        {
            if (!_running) return;
            try
            {
                string body = HttpGet($"{_baseUrl}/api/unity/pending");
                if (string.IsNullOrEmpty(body)) return;

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
                            if (cmdDict.TryGetValue("args", out object argsVal))
                            {
                                if (argsVal is Dictionary<string, object>)
                                    cmd.argsJson = SimpleJson.Serialize(argsVal);
                                else if (argsVal is string s)
                                    cmd.argsJson = s;
                                else
                                    cmd.argsJson = SimpleJson.Serialize(argsVal);
                            }
                            _incomingCommands.Enqueue(cmd);
                        }
                    }
                }
                OnSuccess();
            }
            catch (Exception ex)
            {
                OnError(ex);
            }
        }

        static void StateTick(object state)
        {
            if (!_running) return;
            string json = _pendingStateJson;
            if (string.IsNullOrEmpty(json)) return;

            try
            {
                HttpPost($"{_baseUrl}/api/unity/state", json);
            }
            catch { /* swallow */ }
        }

        // ── HTTP helpers (synchronous, for background threads) ──

        static string HttpGet(string url)
        {
            var request = (HttpWebRequest)WebRequest.Create(url);
            request.Method = "GET";
            request.Timeout = 5000;
            request.ReadWriteTimeout = 5000;

            using (var response = (HttpWebResponse)request.GetResponse())
            using (var stream = response.GetResponseStream())
            using (var reader = new StreamReader(stream, Encoding.UTF8))
            {
                return reader.ReadToEnd();
            }
        }

        static void HttpPost(string url, string jsonBody)
        {
            var request = (HttpWebRequest)WebRequest.Create(url);
            request.Method = "POST";
            request.ContentType = "application/json";
            request.Timeout = 5000;
            request.ReadWriteTimeout = 5000;

            byte[] data = Encoding.UTF8.GetBytes(jsonBody);
            request.ContentLength = data.Length;

            using (var stream = request.GetRequestStream())
            {
                stream.Write(data, 0, data.Length);
            }

            try
            {
                using (var response = (HttpWebResponse)request.GetResponse())
                {
                    // Just consume the response
                }
            }
            catch (WebException wex) when (wex.Response is HttpWebResponse resp && (int)resp.StatusCode == 409)
            {
                // Daemon says "wrong project" — we're pointed at the wrong
                // port. Log once (consecutive-errors suppression handles
                // spam) and invalidate the port cache so the next stat
                // check picks up the registry change. Then rethrow so the
                // caller's OnError accounting kicks in.
                string body = "";
                try
                {
                    using (var s = resp.GetResponseStream())
                    using (var r = new StreamReader(s, Encoding.UTF8))
                        body = r.ReadToEnd();
                }
                catch { /* best-effort */ }
                if (_consecutiveErrors < ErrorLogThreshold)
                {
                    DreamerLog.Warn($"Daemon at {url} rejected our project (409). Body: {body}");
                }
                DaemonClient.InvalidatePortCache();
                throw;
            }
        }

        // ── Error suppression ──

        static void OnSuccess()
        {
            if (_consecutiveErrors > ErrorLogThreshold)
            {
                DreamerLog.Info("Background bridge: daemon connection restored.");
            }
            _consecutiveErrors = 0;
        }

        static void OnError(Exception ex)
        {
            _consecutiveErrors++;
            if (_consecutiveErrors <= ErrorLogThreshold)
            {
                DreamerLog.Warn($"Background bridge error: {ex.Message}");
            }
        }
    }
}
