using System;
using System.Collections.Generic;
using UnityEditor;

namespace Dreamer.AgentBridge
{
    /// <summary>Play-mode toggling. ExecuteMenuItem("Edit/Play") silently returns false because Play/Pause have validation handlers — this exposes EnterPlaymode/ExitPlaymode/isPaused directly. Gated by PlayModePolicy.</summary>
    public static class PlayModeOps
    {
        public static CommandResult SetPlayMode(Dictionary<string, object> args)
        {
            if (!PlayModePolicy.IsAllowed)
                return CommandResult.Fail(PlayModePolicy.DisabledMessage);

            string state = SimpleJson.GetString(args, "state");
            if (string.IsNullOrEmpty(state))
                return CommandResult.Fail("'state' is required: enter | exit | toggle | pause | unpause | toggle-pause");

            bool wasPlaying = EditorApplication.isPlaying;
            bool wasPaused = EditorApplication.isPaused;

            switch (state.Trim().ToLowerInvariant())
            {
                case "enter":
                    if (!wasPlaying) EditorApplication.EnterPlaymode();
                    break;
                case "exit":
                    if (wasPlaying) EditorApplication.ExitPlaymode();
                    break;
                case "toggle":
                    if (wasPlaying) EditorApplication.ExitPlaymode();
                    else EditorApplication.EnterPlaymode();
                    break;
                case "pause":
                    EditorApplication.isPaused = true;
                    break;
                case "unpause":
                    EditorApplication.isPaused = false;
                    break;
                case "toggle-pause":
                    EditorApplication.isPaused = !wasPaused;
                    break;
                default:
                    return CommandResult.Fail(
                        $"Unknown state '{state}'. Valid: enter | exit | toggle | pause | unpause | toggle-pause");
            }

            // Play-mode transitions are async — fields below are immediate, not settled state.
            // Agents wanting confirmation should re-check via /api/status.
            var json = SimpleJson.Object()
                .Put("requestedState", state)
                .Put("wasPlaying", wasPlaying)
                .Put("wasPaused", wasPaused)
                .Put("playMode", EditorApplication.isPlaying)
                .Put("paused", EditorApplication.isPaused)
                .Put("note", "Play-mode transitions are async; check status to confirm settled state.")
                .ToString();

            return CommandResult.Ok(json);
        }
    }

    /// <summary>Per-developer policy (EditorPrefs, not per-project) for whether agents may toggle play mode. Default ON; first-run prompt sets it via PromptIfUnconfigured.</summary>
    public static class PlayModePolicy
    {
        const string PrefAllow = "Dreamer.AllowPlayModeToggle";
        const string PrefConfigured = "Dreamer.AllowPlayModeToggle.Configured";

        public static bool IsAllowed
        {
            get => EditorPrefs.GetBool(PrefAllow, true);
            set
            {
                EditorPrefs.SetBool(PrefAllow, value);
                EditorPrefs.SetBool(PrefConfigured, true);
            }
        }

        public static bool HasBeenConfigured => EditorPrefs.GetBool(PrefConfigured, false);

        public static string DisabledMessage =>
            "Play-mode toggling is disabled by the project owner. " +
            "To enable: open Tools > Dreamer and tick \"Allow play-mode toggle\", " +
            "or set EditorPref 'Dreamer.AllowPlayModeToggle' = true. " +
            "Agents: do not retry; surface this to the user instead.";

        public static void PromptIfUnconfigured()
        {
            if (HasBeenConfigured) return;

            bool allow = EditorUtility.DisplayDialog(
                "Dreamer — Allow agent play-mode toggling?",
                "Should AI agents using Dreamer be allowed to enter, exit, or pause " +
                "play mode in this Unity editor?\n\n" +
                "Allow: agents can call set-play-mode and Edit/Play menu items.\n" +
                "Deny: any agent attempt is refused with a clear error.\n\n" +
                "You can change this later in Tools > Dreamer.",
                "Allow",
                "Deny"
            );

            IsAllowed = allow;
            DreamerLog.Info($"Play-mode toggle policy set to: {(allow ? "ALLOWED" : "DENIED")}.");
        }
    }
}
