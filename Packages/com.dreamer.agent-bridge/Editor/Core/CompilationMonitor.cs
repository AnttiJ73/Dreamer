using System;
using System.Collections.Generic;
using UnityEditor;
using UnityEditor.Compilation;
using UnityEngine;

namespace Dreamer.AgentBridge
{
    /// <summary>Tracks Unity compilation state via CompilationPipeline callbacks; re-registers after every domain reload via Initialize.</summary>
    // Domain-reload survival: `compilationFinished` fires in the OLD AppDomain just before
    // the reload wipes static fields. We persist via SessionState and rehydrate in Initialize
    // so the daemon doesn't see a permanently-stale lastCompile timestamp after reloads.
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

            // SessionState survives domain reloads.
            var savedTime = SessionState.GetString(SessionKeyTime, "");
            if (!string.IsNullOrEmpty(savedTime)
                && DateTime.TryParse(savedTime, null, System.Globalization.DateTimeStyles.RoundtripKind, out var parsed))
            {
                LastCompileTime = parsed;
            }
            LastCompileSucceeded = SessionState.GetBool(SessionKeySucceeded, true);

            CompilationPipeline.compilationStarted += OnCompilationStarted;
            CompilationPipeline.compilationFinished += OnCompilationFinished;
            CompilationPipeline.assemblyCompilationFinished += OnAssemblyCompilationFinished;

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

            // Persist immediately — `compilationFinished` fires in the OLD AppDomain just
            // before the reload wipes static state. SessionState writes synchronously.
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
