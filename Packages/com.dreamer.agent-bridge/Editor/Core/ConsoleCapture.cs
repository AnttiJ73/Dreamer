using System;
using System.Collections.Generic;
using UnityEngine;

namespace Dreamer.AgentBridge
{
    /// <summary>Captures Unity console log entries into a ring buffer; re-registers after every domain reload via Initialize.</summary>
    public static class ConsoleCapture
    {
        const int BufferSize = 200;

        static readonly ConsoleEntry[] _buffer = new ConsoleEntry[BufferSize];
        static int _head;
        static int _count;
        static bool _registered;

        public static void Initialize()
        {
            if (_registered) return;
            _registered = true;
            _head = 0;
            _count = 0;
            Application.logMessageReceived += OnLogMessage;
        }

        public static void Shutdown()
        {
            if (!_registered) return;
            _registered = false;
            Application.logMessageReceived -= OnLogMessage;
        }

        /// <summary>Most recent N console entries, oldest first.</summary>
        public static ConsoleEntry[] GetEntries(int count)
        {
            int n = Math.Min(count, _count);
            var result = new ConsoleEntry[n];
            int start = (_head - n + BufferSize) % BufferSize;
            for (int i = 0; i < n; i++)
            {
                result[i] = _buffer[(start + i) % BufferSize];
            }
            return result;
        }

        public static void Clear()
        {
            _head = 0;
            _count = 0;
            Array.Clear(_buffer, 0, BufferSize);
        }

        static void OnLogMessage(string message, string stackTrace, LogType logType)
        {
            // Skip Dreamer's own messages — DreamerLog keeps the tag as plain text inside the
            // rich-text color wrapper so substring match works regardless of color tags.
            if (message != null && message.Contains(DreamerLog.Tag)) return;

            string typeStr;
            switch (logType)
            {
                case LogType.Error:     typeStr = "Error";   break;
                case LogType.Assert:    typeStr = "Assert";  break;
                case LogType.Warning:   typeStr = "Warning"; break;
                case LogType.Exception: typeStr = "Exception"; break;
                default:                typeStr = "Log";     break;
            }

            _buffer[_head] = new ConsoleEntry
            {
                message = message ?? "",
                type = typeStr,
                timestamp = DateTime.UtcNow.ToString("o")
            };

            _head = (_head + 1) % BufferSize;
            if (_count < BufferSize) _count++;
        }
    }
}
