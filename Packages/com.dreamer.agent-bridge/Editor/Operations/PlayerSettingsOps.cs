using System;
using System.Collections.Generic;
using UnityEditor;
using UnityEditor.Build;
using UnityEngine;

namespace Dreamer.AgentBridge
{
    /// <summary>PlayerSettings authoring via the static UnityEditor.PlayerSettings API. Some fields (icons, per-platform app id, cursor) only round-trip cleanly through the static setters — SerializedObject can't reach the per-platform dictionaries.</summary>
    public static class PlayerSettingsOps
    {
        // ─── inspect-player-settings ──────────────────────────────────────

        public static CommandResult InspectPlayerSettings(Dictionary<string, object> args)
        {
            string targetArg = SimpleJson.GetString(args, "target");
            var defaultTarget = NamedBuildTarget.Standalone;
            var named = string.IsNullOrEmpty(targetArg)
                ? defaultTarget
                : ResolveNamedBuildTarget(targetArg, out string _);

            var json = SimpleJson.Object()
                .Put("companyName", PlayerSettings.companyName ?? "")
                .Put("productName", PlayerSettings.productName ?? "")
                .Put("bundleVersion", PlayerSettings.bundleVersion ?? "")
                .Put("targetPlatform", named.TargetName)
                .Put("applicationIdentifier", PlayerSettings.GetApplicationIdentifier(named) ?? "")
                .Put("defaultScreenWidth", PlayerSettings.defaultScreenWidth)
                .Put("defaultScreenHeight", PlayerSettings.defaultScreenHeight)
                .Put("fullScreenMode", PlayerSettings.fullScreenMode.ToString())
                .Put("resizableWindow", PlayerSettings.resizableWindow)
                .Put("runInBackground", PlayerSettings.runInBackground)
                .Put("captureSingleScreen", PlayerSettings.captureSingleScreen)
                .Put("colorSpace", PlayerSettings.colorSpace.ToString())
                .Put("scriptingBackend", PlayerSettings.GetScriptingBackend(named).ToString())
                .Put("apiCompatibilityLevel", PlayerSettings.GetApiCompatibilityLevel(named).ToString());

            string cursorPath = PlayerSettings.defaultCursor != null
                ? AssetDatabase.GetAssetPath(PlayerSettings.defaultCursor)
                : null;
            json.Put("cursorTexture", cursorPath ?? "");
            json.PutRaw("cursorHotspot", $"[{PlayerSettings.cursorHotspot.x},{PlayerSettings.cursorHotspot.y}]");

            var defaultIcons = PlayerSettings.GetIcons(NamedBuildTarget.Unknown, IconKind.Application);
            json.PutRaw("defaultIcons", IconArrayToJson(defaultIcons));

            var platformIcons = PlayerSettings.GetIcons(named, IconKind.Application);
            var platformIconObj = SimpleJson.Object()
                .Put("target", named.TargetName)
                .PutRaw("textures", IconArrayToJson(platformIcons));
            json.PutRaw("platformIcons", platformIconObj.ToString());

            return CommandResult.Ok(json.ToString());
        }

        // ─── set-app-id ────────────────────────────────────────────────────

        public static CommandResult SetAppId(Dictionary<string, object> args)
        {
            string targetArg = SimpleJson.GetString(args, "target");
            string id = SimpleJson.GetString(args, "id");
            if (string.IsNullOrEmpty(id))
                return CommandResult.Fail("'id' is required (e.g. 'com.example.app').");

            var named = ResolveNamedBuildTarget(targetArg ?? "standalone", out string err);
            if (err != null) return CommandResult.Fail(err);

            string previous = PlayerSettings.GetApplicationIdentifier(named);
            PlayerSettings.SetApplicationIdentifier(named, id);
            AssetDatabase.SaveAssets();

            return CommandResult.Ok(SimpleJson.Object()
                .Put("target", named.TargetName)
                .Put("previousId", previous ?? "")
                .Put("id", id)
                .ToString());
        }

        // ─── set-default-icon ──────────────────────────────────────────────

        public static CommandResult SetDefaultIcon(Dictionary<string, object> args)
        {
            string texPath = SimpleJson.GetString(args, "texture");
            if (string.IsNullOrEmpty(texPath))
                return CommandResult.Fail("'texture' is required (path to a Texture2D asset).");

            var tex = AssetDatabase.LoadAssetAtPath<Texture2D>(texPath);
            if (tex == null)
                return CommandResult.Fail($"Texture not found at '{texPath}'. Ensure the asset exists and its TextureImporter type is Default (not Sprite).");

            PlayerSettings.SetIcons(NamedBuildTarget.Unknown, new[] { tex }, IconKind.Application);
            AssetDatabase.SaveAssets();

            return CommandResult.Ok(SimpleJson.Object()
                .Put("texture", texPath)
                .Put("target", "default")
                .Put("set", true)
                .ToString());
        }

        // ─── set-app-icons ─────────────────────────────────────────────────

        public static CommandResult SetAppIcons(Dictionary<string, object> args)
        {
            string targetArg = SimpleJson.GetString(args, "target");
            var named = ResolveNamedBuildTarget(targetArg ?? "default", out string err);
            if (err != null) return CommandResult.Fail(err);

            if (!args.TryGetValue("textures", out object texturesObj) || !(texturesObj is List<object> texList))
                return CommandResult.Fail("'textures' is required (JSON array of asset paths).");

            // Unity pads or truncates silently if the array length doesn't match its slot count — warn the agent.
            var expectedSizes = PlayerSettings.GetIconSizes(named, IconKind.Application);
            int expected = expectedSizes != null ? expectedSizes.Length : 0;

            var textures = new Texture2D[texList.Count];
            for (int i = 0; i < texList.Count; i++)
            {
                string p = texList[i] as string;
                if (string.IsNullOrEmpty(p))
                    return CommandResult.Fail($"textures[{i}]: expected a string path.");
                var t = AssetDatabase.LoadAssetAtPath<Texture2D>(p);
                if (t == null)
                    return CommandResult.Fail($"textures[{i}]: Texture2D not found at '{p}'.");
                textures[i] = t;
            }

            PlayerSettings.SetIcons(named, textures, IconKind.Application);
            AssetDatabase.SaveAssets();

            var result = SimpleJson.Object()
                .Put("target", named.TargetName)
                .Put("count", textures.Length)
                .Put("expectedCount", expected);
            if (expected > 0 && expected != textures.Length)
                result.Put("warning", $"Expected {expected} icon textures for {named.TargetName}; got {textures.Length}. Unity will pad or truncate.");
            return CommandResult.Ok(result.ToString());
        }

        // ─── set-cursor-icon ───────────────────────────────────────────────

        public static CommandResult SetCursorIcon(Dictionary<string, object> args)
        {
            string texPath = SimpleJson.GetString(args, "texture");
            if (string.IsNullOrEmpty(texPath))
                return CommandResult.Fail("'texture' is required (or pass null to clear via set-project-setting).");

            var tex = AssetDatabase.LoadAssetAtPath<Texture2D>(texPath);
            if (tex == null)
                return CommandResult.Fail($"Texture not found at '{texPath}'. Ensure the asset's TextureImporter type is Cursor (or Default with Read/Write enabled).");

            PlayerSettings.defaultCursor = tex;

            if (args.TryGetValue("hotspot", out object hotspotObj) && hotspotObj is List<object> hsList && hsList.Count >= 2)
            {
                PlayerSettings.cursorHotspot = new Vector2(ToFloat(hsList[0]), ToFloat(hsList[1]));
            }
            AssetDatabase.SaveAssets();

            return CommandResult.Ok(SimpleJson.Object()
                .Put("texture", texPath)
                .PutRaw("hotspot", $"[{PlayerSettings.cursorHotspot.x},{PlayerSettings.cursorHotspot.y}]")
                .Put("set", true)
                .ToString());
        }

        // ─── Helpers ───────────────────────────────────────────────────────

        internal static NamedBuildTarget ResolveNamedBuildTarget(string nameOrIndex, out string error)
        {
            error = null;
            if (string.IsNullOrEmpty(nameOrIndex)) { error = "Target name is empty."; return NamedBuildTarget.Standalone; }
            string n = nameOrIndex.Trim().ToLowerInvariant();
            switch (n)
            {
                case "default":
                case "unknown":
                case "all":
                    return NamedBuildTarget.Unknown;
                case "standalone":
                case "windows":
                case "mac":
                case "linux":
                    return NamedBuildTarget.Standalone;
                case "android":
                    return NamedBuildTarget.Android;
                case "ios":
                case "iphone":
                    return NamedBuildTarget.iOS;
                case "webgl":
                    return NamedBuildTarget.WebGL;
                case "tvos":
                    return NamedBuildTarget.tvOS;
                case "windowsstore":
                case "uwp":
                    return NamedBuildTarget.WindowsStoreApps;
                case "ps4":
                    return NamedBuildTarget.PS4;
                case "ps5":
                    return NamedBuildTarget.PS5;
                case "xboxone":
                    return NamedBuildTarget.XboxOne;
                case "switch":
                case "nintendoswitch":
                    return NamedBuildTarget.NintendoSwitch;
            }
            error = $"Unknown build target: '{nameOrIndex}'. Valid: default, standalone, android, ios, webgl, tvos, windowsstore, ps4, ps5, xboxone, switch.";
            return NamedBuildTarget.Standalone;
        }

        static string IconArrayToJson(Texture2D[] icons)
        {
            var arr = SimpleJson.Array();
            if (icons != null)
            {
                foreach (var t in icons)
                {
                    string path = t != null ? AssetDatabase.GetAssetPath(t) : "";
                    arr.Add(path ?? "");
                }
            }
            return arr.ToString();
        }

        static float ToFloat(object o)
        {
            if (o is double d) return (float)d;
            if (o is float f) return f;
            if (o is long l) return l;
            if (o is int i) return i;
            if (o is string s && float.TryParse(s, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out float r)) return r;
            return 0f;
        }
    }
}
