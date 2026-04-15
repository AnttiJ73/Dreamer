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
            _handlers["save_assets"]       = AssetOps.SaveAssets;
            _handlers["refresh_assets"]    = AssetOps.RefreshAssets;

            // Script operations
            _handlers["create_script"]     = ScriptOps.CreateScript;

            // Component operations
            _handlers["add_component"]     = ComponentOps.AddComponent;
            _handlers["remove_component"]  = ComponentOps.RemoveComponent;

            // Property operations
            _handlers["set_property"]      = PropertyOps.SetProperty;

            // Prefab operations
            _handlers["create_prefab"]       = PrefabOps.CreatePrefab;
            _handlers["add_child_to_prefab"] = PrefabOps.AddChildToPrefab;
            _handlers["save_as_prefab"]      = PrefabOps.SaveAsPrefab;
            _handlers["instantiate_prefab"]  = SceneOps.InstantiatePrefab;

            // Scene operations
            _handlers["create_gameobject"]   = SceneOps.CreateGameObject;
            _handlers["delete_gameobject"]   = SceneOps.DeleteGameObject;
            _handlers["rename_gameobject"]   = SceneOps.RenameGameObject;
            _handlers["duplicate"]           = SceneOps.DuplicateGameObject;
            _handlers["create_hierarchy"]    = SceneOps.CreateHierarchy;
            _handlers["inspect_hierarchy"]   = SceneOps.InspectHierarchy;
            _handlers["create_scene"]        = SceneOps.CreateScene;
            _handlers["open_scene"]          = SceneOps.OpenScene;
            _handlers["save_scene"]          = SceneOps.SaveScene;

            // Editor operations
            _handlers["execute_menu_item"]       = EditorOps.ExecuteMenuItem;
            _handlers["execute_method"]          = EditorOps.ExecuteMethod;

            // ScriptableObject operations
            _handlers["create_scriptable_object"] = AssetOps.CreateScriptableObject;
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
                    result = CommandResult.Fail($"Unknown command kind: {command.kind}");
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
                || kind == "inspect_hierarchy"
                || kind == "create_scene"
                || kind == "open_scene";
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
