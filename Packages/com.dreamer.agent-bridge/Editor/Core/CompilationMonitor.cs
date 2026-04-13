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
    /// </summary>
    public static class CompilationMonitor
    {
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
