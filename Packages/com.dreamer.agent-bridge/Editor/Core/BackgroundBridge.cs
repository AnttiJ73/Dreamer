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
    /// <summary>Background-thread HTTP bridge that works even when Unity is unfocused (EditorApplication.update doesn't tick on Windows without focus).</summary>
    public static class BackgroundBridge
    {
        static Timer _heartbeatTimer;
        static Timer _pollTimer;
        static Timer _stateTimer;

        static readonly ConcurrentQueue<BridgeCommand> _incomingCommands = new ConcurrentQueue<BridgeCommand>();
        static volatile bool _running;
        static string _baseUrl;

        // Application.dataPath is not safe to call from background threads — capture on Start.
        static string _projectPath;

        static volatile string _pendingStateJson;

        static int _consecutiveErrors;
        const int ErrorLogThreshold = 3;

        public static bool IsRunning => _running;

        public static void Start(string baseUrl)
        {
            if (_running) return;
            _running = true;
            _baseUrl = baseUrl;
            _consecutiveErrors = 0;

            try { _projectPath = System.IO.Path.GetDirectoryName(Application.dataPath); }
            catch { _projectPath = null; }

            _heartbeatTimer = new Timer(HeartbeatTick, null, 0, 3000);
            _pollTimer = new Timer(PollTick, null, 500, 250);
            _stateTimer = new Timer(StateTick, null, 1000, 2000);
        }

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

            while (_incomingCommands.TryDequeue(out _)) { }
        }

        /// <summary>Dequeue a command received from the daemon. Main thread.</summary>
        public static bool TryDequeueCommand(out BridgeCommand cmd)
        {
            return _incomingCommands.TryDequeue(out cmd);
        }

        /// <summary>Set the state JSON for the next state tick. Main thread.</summary>
        public static void SetStateSnapshot(string json)
        {
            _pendingStateJson = json;
        }

        /// <summary>Update the base URL — call on `dreamer registry reassign` so we don't keep hammering the old port until Unity restarts.</summary>
        public static void UpdateBaseUrl(string baseUrl)
        {
            if (string.IsNullOrEmpty(baseUrl) || baseUrl == _baseUrl) return;
            DreamerLog.Info($"Daemon URL changed: {_baseUrl} → {baseUrl}");
            _baseUrl = baseUrl;
            _consecutiveErrors = 0;
        }

        /// <summary>Report a command result to the daemon (thread pool).</summary>
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

                // Piggyback state on heartbeat so daemon's `hasReceivedState` flips even when
                // main thread isn't ticking (Windows + unfocused editor). Without this, a fresh
                // daemon deadlocks all compile-gated commands until the user focuses Unity.
                body.Put("compiling", CompilationMonitor.IsCompiling);
                body.Put("compileErrors", CompilationMonitor.GetErrorArray());

                // Report last-compile memory so a restarted daemon can restore lastCompileSuccess
                // instead of showing `idle` until the next compile cycle fires.
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
                using (var response = (HttpWebResponse)request.GetResponse()) { }
            }
            catch (WebException wex) when (wex.Response is HttpWebResponse resp && (int)resp.StatusCode == 409)
            {
                // Daemon says "wrong project" — we're pointed at the wrong port. Log once,
                // invalidate the port cache so the next stat check picks up the registry change,
                // then rethrow so OnError accounting kicks in.
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
