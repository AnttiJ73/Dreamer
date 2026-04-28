// Dreamer.AgentBridge — Command Dispatcher
using System;
using System.Collections.Generic;
using UnityEngine;

namespace Dreamer.AgentBridge
{
    /// <summary>
    /// Routes BridgeCommand.kind to the appropriate operation handler.
    /// </summary>
    public static class CommandDispatcher
    {
        static readonly Dictionary<string, Func<Dictionary<string, object>, CommandResult>> _handlers
            = new Dictionary<string, Func<Dictionary<string, object>, CommandResult>>();

        static readonly List<CommandRecord> _recentCommands = new List<CommandRecord>();
        const int MaxRecentCommands = 20;

        public static IReadOnlyList<CommandRecord> RecentCommands => _recentCommands;

        public static void Initialize()
        {
            _handlers.Clear();
            _recentCommands.Clear();

            // Asset operations
            _handlers["find_assets"]       = AssetOps.FindAssets;
            _handlers["inspect_asset"]     = AssetOps.InspectAsset;
            _handlers["inspect_assets"]    = AssetOps.InspectAssets;
            _handlers["save_assets"]       = AssetOps.SaveAssets;
            _handlers["refresh_assets"]    = AssetOps.RefreshAssets;
            _handlers["reimport_scripts"]  = AssetOps.ReimportScripts;

            // Script operations
            _handlers["create_script"]     = ScriptOps.CreateScript;

            // Component operations
            _handlers["add_component"]           = ComponentOps.AddComponent;
            _handlers["remove_component"]        = ComponentOps.RemoveComponent;
            _handlers["remove_missing_scripts"]  = ComponentOps.RemoveMissingScripts;

            // Property operations
            _handlers["set_property"]      = PropertyOps.SetProperty;
            _handlers["read_property"]     = PropertyOps.ReadProperty;

            // Prefab operations
            _handlers["create_prefab"]       = PrefabOps.CreatePrefab;
            _handlers["add_child_to_prefab"] = PrefabOps.AddChildToPrefab;
            _handlers["save_as_prefab"]      = PrefabOps.SaveAsPrefab;
            _handlers["instantiate_prefab"]  = SceneOps.InstantiatePrefab;

            // Scene operations
            _handlers["create_gameobject"]   = SceneOps.CreateGameObject;
            _handlers["delete_gameobject"]   = SceneOps.DeleteGameObject;
            _handlers["rename_gameobject"]   = SceneOps.RenameGameObject;
            _handlers["reparent_gameobject"] = SceneOps.ReparentGameObject;
            _handlers["duplicate"]           = SceneOps.DuplicateGameObject;
            _handlers["create_hierarchy"]    = SceneOps.CreateHierarchy;
            _handlers["inspect_hierarchy"]   = SceneOps.InspectHierarchy;
            _handlers["create_scene"]        = SceneOps.CreateScene;
            _handlers["open_scene"]          = SceneOps.OpenScene;
            _handlers["save_scene"]          = SceneOps.SaveScene;

            // Editor operations
            _handlers["execute_menu_item"]       = EditorOps.ExecuteMenuItem;
            _handlers["execute_method"]          = EditorOps.ExecuteMethod;
            _handlers["set_play_mode"]           = PlayModeOps.SetPlayMode;

            // Project Settings — convenience commands + generic editor.
            _handlers["inspect_project_settings"] = ProjectSettingsOps.InspectProjectSettings;
            _handlers["set_layer_name"]           = ProjectSettingsOps.SetLayerName;
            _handlers["clear_layer"]              = ProjectSettingsOps.ClearLayer;
            _handlers["add_tag"]                  = ProjectSettingsOps.AddTag;
            _handlers["remove_tag"]               = ProjectSettingsOps.RemoveTag;
            _handlers["add_sorting_layer"]        = ProjectSettingsOps.AddSortingLayer;
            _handlers["remove_sorting_layer"]     = ProjectSettingsOps.RemoveSortingLayer;
            _handlers["set_layer_collision"]      = ProjectSettingsOps.SetLayerCollision;
            _handlers["set_physics_gravity"]      = ProjectSettingsOps.SetPhysicsGravity;
            _handlers["set_project_setting"]      = ProjectSettingsOps.SetProjectSetting;
            _handlers["inspect_project_setting"]  = ProjectSettingsOps.InspectProjectSetting;

            // PlayerSettings (static API path — for fields that don't round-trip via SerializedObject).
            _handlers["inspect_player_settings"]  = PlayerSettingsOps.InspectPlayerSettings;
            _handlers["set_app_id"]               = PlayerSettingsOps.SetAppId;
            _handlers["set_default_icon"]         = PlayerSettingsOps.SetDefaultIcon;
            _handlers["set_app_icons"]            = PlayerSettingsOps.SetAppIcons;
            _handlers["set_cursor_icon"]          = PlayerSettingsOps.SetCursorIcon;

            // Visual feedback — render assets to PNG so agents can "see".
            _handlers["screenshot_prefab"]        = PreviewOps.ScreenshotPrefab;

            // EditorBuildSettings.scenes — the build-scenes list.
            _handlers["inspect_build_scenes"]     = BuildSettingsOps.InspectBuildScenes;
            _handlers["set_build_scenes"]         = BuildSettingsOps.SetBuildScenes;
            _handlers["add_build_scene"]          = BuildSettingsOps.AddBuildScene;
            _handlers["remove_build_scene"]       = BuildSettingsOps.RemoveBuildScene;

            // ScriptableObject operations
            _handlers["create_scriptable_object"] = AssetOps.CreateScriptableObject;

            // Material operations
            _handlers["create_material"]         = MaterialOps.CreateMaterial;
            _handlers["inspect_material"]        = MaterialOps.InspectMaterial;
            _handlers["set_material_property"]   = MaterialOps.SetMaterialProperty;
            _handlers["set_material_shader"]     = MaterialOps.SetMaterialShader;

            // ParticleSystem operations (config exposed via wrapper structs that
            // generic set-property can't reach — see ParticleOps for details).
            _handlers["set_particle_property"]   = ParticleOps.SetParticleProperty;

            // Shader operations
            _handlers["shader_status"]           = ShaderOps.ShaderStatus;
            _handlers["inspect_shader"]          = ShaderOps.InspectShader;

            // Add-on plugin discovery. Each add-on ships a type named
            // "Dreamer.AgentBridge.<Name>.Registration" with a static
            // `Register(IDictionary<string, Func<Dictionary<string,object>, CommandResult>>)`
            // method. Core discovers them via reflection so it can compile + run
            // standalone, and add-ons can drop in without any edits here.
            DiscoverPluginRegistrations();
        }

        /// <summary>
        /// Reflection-based plugin discovery. Finds every assembly-accessible
        /// type whose full name ends in ".Registration" and is in the
        /// Dreamer.AgentBridge namespace family, then invokes its static
        /// `Register` method with our handler dictionary. Keeps core
        /// decoupled from optional add-on packages — nothing here fails if
        /// an add-on is absent.
        /// </summary>
        static void DiscoverPluginRegistrations()
        {
            foreach (var asm in System.AppDomain.CurrentDomain.GetAssemblies())
            {
                Type[] types;
                try { types = asm.GetTypes(); }
                catch (System.Reflection.ReflectionTypeLoadException rtle) { types = rtle.Types; }
                catch { continue; }

                if (types == null) continue;
                foreach (var t in types)
                {
                    if (t == null) continue;
                    if (t.FullName == null) continue;
                    if (!t.FullName.StartsWith("Dreamer.AgentBridge.", System.StringComparison.Ordinal)) continue;
                    if (!t.FullName.EndsWith(".Registration", System.StringComparison.Ordinal)) continue;

                    var m = t.GetMethod("Register",
                        System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static);
                    if (m == null) continue;
                    try
                    {
                        m.Invoke(null, new object[] { _handlers });
                        DreamerLog.Info($"Plugin registered: {t.FullName}");
                    }
                    catch (System.Exception ex)
                    {
                        DreamerLog.Warn($"Plugin registration failed for {t.FullName}: {ex.Message}");
                    }
                }
            }
        }

        /// <summary>Dispatch a command and return the result.</summary>
        public static CommandResult Dispatch(BridgeCommand command)
        {
            if (command == null)
                return CommandResult.Fail("Null command");

            var record = new CommandRecord
            {
                id = command.id,
                kind = command.kind,
                startTime = DateTime.UtcNow
            };

            CommandResult result;
            try
            {
                if (!_handlers.TryGetValue(command.kind, out var handler))
                {
                    // Unity-side rejection — handler not registered. Distinct
                    // from the daemon-side "Unknown command kind" rejection
                    // (which never reaches Unity). The "[unity-bridge]" tag
                    // is the disambiguator: if you see this exact prefix,
                    // it's a registration / domain-reload problem on Unity's
                    // side; if you see "source: daemon" in a 400 response,
                    // restart the daemon process instead.
                    result = CommandResult.Fail(
                        $"Unknown command kind '{command.kind}' [unity-bridge]. " +
                        "The daemon accepted this kind but the Unity-side dispatcher has no handler registered. " +
                        "Likely causes: (1) the add-on package providing this kind isn't installed, " +
                        "(2) a domain reload is pending and Initialize() hasn't run with the new code yet, " +
                        "(3) the add-on's Registration.cs failed silently — check the Editor.log for plugin discovery errors.");
                }
                else if (CompilationMonitor.IsCompiling && !IsCompileSafe(command.kind))
                {
                    result = CommandResult.Fail("Cannot execute this command while Unity is compiling. Wait for compilation to finish.");
                }
                else
                {
                    var args = SimpleJson.Deserialize(command.argsJson ?? "{}");
                    result = handler(args);
                }
            }
            catch (Exception ex)
            {
                DreamerLog.Warn($"Command '{command.kind}' threw: {ex}");
                result = CommandResult.Fail($"Internal error: {ex.Message}");
            }

            record.endTime = DateTime.UtcNow;
            record.success = result.success;
            record.error = result.error;

            _recentCommands.Insert(0, record);
            if (_recentCommands.Count > MaxRecentCommands)
                _recentCommands.RemoveAt(_recentCommands.Count - 1);

            return result;
        }

        /// <summary>Commands that are safe to run even during compilation.</summary>
        static bool IsCompileSafe(string kind)
        {
            return kind == "find_assets"
                || kind == "inspect_asset"
                || kind == "inspect_assets"
                || kind == "inspect_hierarchy"
                || kind == "inspect_material"
                || kind == "inspect_shader"
                || kind == "shader_status"
                || kind == "read_property"
                || kind == "create_scene"
                || kind == "open_scene"
                || kind == "inspect_project_settings"
                || kind == "inspect_project_setting"
                || kind == "inspect_player_settings"
                || kind == "inspect_build_scenes";
        }

        public class CommandRecord
        {
            public string id;
            public string kind;
            public DateTime startTime;
            public DateTime endTime;
            public bool success;
            public string error;
        }
    }
}
