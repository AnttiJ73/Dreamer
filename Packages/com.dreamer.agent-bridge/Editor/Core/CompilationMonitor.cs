using System;
using System.Collections.Generic;
using UnityEditor;
using UnityEditor.Compilation;
using UnityEngine;

namespace Dreamer.AgentBridge
{
    /// <summary>
    /// Tracks Unity compilation state via CompilationPipeline callbacks.
    /// Re-registers after every domain reload via Initialize.
    ///
    /// Domain-reload survival: `compilationFinished` fires in the OLD AppDomain
    /// just before the reload, then plain static fields get wiped when the new
    /// AppDomain loads. To avoid a permanently-stale lastCompile timestamp on
    /// the daemon side, we persist via Unity's SessionState (per-editor-session
    /// key/value store on disk in Library/) and rehydrate the in-memory fields
    /// in Initialize. Without this, the bridge tells the daemon "compile time:
    /// null" forever after the first reload, and `dreamer compile-status` keeps
    /// reporting the last value the daemon happened to see — usually 20+ minutes
    /// out of date even when Unity has compiled multiple times since.
    /// </summary>
    public static class CompilationMonitor
    {
        const string SessionKeyTime      = "Dreamer.LastCompileTime";
        const string SessionKeySucceeded = "Dreamer.LastCompileSucceeded";

        public static bool IsCompiling { get; private set; }
        public static bool LastCompileSucceeded { get; private set; } = true;
        public static DateTime? LastCompileTime { get; private set; }

        static readonly List<string> _compileErrors = new List<string>();
        public static IReadOnlyList<string> CompileErrors => _compileErrors;

        static bool _registered;

        public static void Initialize()
        {
            if (_registered) return;
            _registered = true;

            // Rehydrate from SessionState first — these survive domain reloads.
            var savedTime = SessionState.GetString(SessionKeyTime, "");
            if (!string.IsNullOrEmpty(savedTime)
                && DateTime.TryParse(savedTime, null, System.Globalization.DateTimeStyles.RoundtripKind, out var parsed))
            {
                LastCompileTime = parsed;
            }
            // SessionState bool default arg is the value when missing — start as success.
            LastCompileSucceeded = SessionState.GetBool(SessionKeySucceeded, true);

            CompilationPipeline.compilationStarted += OnCompilationStarted;
            CompilationPipeline.compilationFinished += OnCompilationFinished;
            CompilationPipeline.assemblyCompilationFinished += OnAssemblyCompilationFinished;

            // Sync initial state
            IsCompiling = EditorApplication.isCompiling;
        }

        public static void Shutdown()
        {
            if (!_registered) return;
            _registered = false;

            CompilationPipeline.compilationStarted -= OnCompilationStarted;
            CompilationPipeline.compilationFinished -= OnCompilationFinished;
            CompilationPipeline.assemblyCompilationFinished -= OnAssemblyCompilationFinished;
        }

        public static string[] GetErrorArray()
        {
            return _compileErrors.ToArray();
        }

        static void OnCompilationStarted(object context)
        {
            IsCompiling = true;
            _compileErrors.Clear();
        }

        static void OnCompilationFinished(object context)
        {
            IsCompiling = false;
            LastCompileTime = DateTime.UtcNow;
            LastCompileSucceeded = _compileErrors.Count == 0;

            // Persist immediately — `compilationFinished` fires in the OLD AppDomain
            // moments before the reload wipes static state. SessionState writes go to
            // disk synchronously on this same call frame, so the values are durable
            // by the time the new AppDomain starts up and Initialize() rehydrates.
            SessionState.SetString(SessionKeyTime, LastCompileTime.Value.ToString("o"));
            SessionState.SetBool(SessionKeySucceeded, LastCompileSucceeded);
        }

        static void OnAssemblyCompilationFinished(string assemblyPath, CompilerMessage[] messages)
        {
            foreach (var msg in messages)
            {
                if (msg.type == CompilerMessageType.Error)
                {
                    _compileErrors.Add($"{msg.file}({msg.line},{msg.column}): {msg.message}");
                }
            }
        }
    }
}
