using UnityEngine;

namespace Dreamer.AgentBridge
{
    /// <summary>
    /// Branded console logger for Dreamer. Wraps UnityEngine.Debug with a
    /// colored [Dreamer] prefix so users can pick Dreamer's messages out of
    /// Unity's Console window at a glance. Unity's Console renders rich-text
    /// color tags in editor logs.
    ///
    /// Also keeps the tag in the raw message (not just the color tag), so
    /// ConsoleCapture can filter Dreamer's own logs out of the stream it
    /// relays back to agents.
    /// </summary>
    public static class DreamerLog
    {
        public const string Tag = "[Dreamer]";
        const string InfoColor = "#5CC8FF";  // cyan
        const string WarnColor = "#FFC857";  // amber
        const string ErrorColor = "#FF5D6C"; // coral

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
