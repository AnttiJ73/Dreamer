using UnityEngine;

namespace Dreamer.AgentBridge
{
    /// <summary>Branded console logger. The [Dreamer] tag stays in the raw message (not just the color wrapper) so ConsoleCapture can filter Dreamer's own logs out of the stream it relays back to agents.</summary>
    public static class DreamerLog
    {
        public const string Tag = "[Dreamer]";
        const string InfoColor = "#5CC8FF";
        const string WarnColor = "#FFC857";
        const string ErrorColor = "#FF5D6C";

        public static void Info(string message)
            => Debug.Log(Format(message, InfoColor));

        public static void Warn(string message)
            => Debug.LogWarning(Format(message, WarnColor));

        public static void Error(string message)
            => Debug.LogError(Format(message, ErrorColor));

        static string Format(string message, string color)
            => $"<color={color}><b>{Tag}</b></color> {message}";
    }
}
