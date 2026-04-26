# Dreamer task → command index

Flat lookup table. "I want to do X" → run command Y. For arg details and examples, run `./bin/dreamer help <kind>` (kind names listed in the right column).

## Discovery

| Task | Command | Kind |
|---|---|---|
| Find assets matching a pattern | `find-assets --type prefab --name "Player*"` | `find_assets` |
| Inspect a prefab (its components and children) | `inspect <path>` or `inspect --asset <path> --component <T>` | `inspect_asset` |
| Inspect a child inside a prefab | `inspect --asset <path> --child-path <SUB>` | `inspect_asset` |
| Read the active scene's hierarchy | `inspect-hierarchy` | `inspect_hierarchy` |
| Inspect a Material's shader/properties | `inspect-material --asset <.mat>` | `inspect_material` |
| Inspect a Shader's declared interface | `inspect-shader --shader "URP/Lit"` or `--asset <.shader>` | `inspect_shader` |
| Read a uGUI tree back as JSON | `inspect-ui-tree --target <scene path>` | `inspect_ui_tree` |
| See recent Unity console output | `console --count 50` | `console` |
| Check compile state | `compile-status` (reads daemon — no `--wait`) | `compile_status` |

## Create — assets

| Task | Command | Kind |
|---|---|---|
| Create a C# script | `create-script --name X --namespace N [--template monobehaviour]` | `create_script` |
| Create an empty prefab | `create-prefab --name X --path Assets/Prefabs` | `create_prefab` |
| Build a prefab WITH structure + components inline | `create-hierarchy --save-path Assets/Prefabs --json '{...}'` | `create_hierarchy` |
| Create a Material | `create-material --name X --shader "URP/Lit"` | `create_material` |
| Create a ScriptableObject instance | `create-scriptable-object --type <FQN> --name X --path Assets/Data` | `create_scriptable_object` |
| Create a new scene file | `create-scene --name X --set-active true` | `create_scene` |

## Create — scene objects

| Task | Command | Kind |
|---|---|---|
| Create a single empty GameObject | `create-gameobject --name X [--parent <path>]` | `create_gameobject` |
| Build a tree of GameObjects in the scene | `create-hierarchy --json '{...}'` (omit `--save-path`) | `create_hierarchy` |
| Drop a prefab instance into the scene | `instantiate-prefab --asset <prefab> [--parent <path>] [--position {x,y,z}]` | `instantiate_prefab` |
| Add an empty child inside an existing prefab | `add-child-to-prefab --asset <prefab> --child-name X [--parent-path SUB]` | `add_child_to_prefab` |

## Edit — components

| Task | Command | Kind |
|---|---|---|
| Add a component to a prefab root | `add-component --asset <prefab> --type <FQN>` | `add_component` |
| Add a component to a prefab CHILD | `add-component --asset <prefab> --child-path <SUB> --type <FQN>` | `add_component` |
| Add a component to a scene object | `add-component --scene-object <path> --type <FQN>` | `add_component` |
| Remove a component from a prefab root | `remove-component --asset <prefab> --type <FQN>` | `remove_component` |
| Remove a component from a prefab CHILD | `remove-component --asset <prefab> --child-path <SUB> --type <FQN>` | `remove_component` |
| Remove "Missing (Mono Script)" entries | `remove-missing-scripts --path Assets/Prefabs [--dry-run]` | `remove_missing_scripts` |

## Edit — properties

| Task | Command | Kind |
|---|---|---|
| Set a primitive property | `set-property --asset <prefab> --component <T> --property <name> --value <JSON>` | `set_property` |
| Set property on a prefab CHILD's component | add `--child-path <SUB>` | `set_property` |
| Wire an asset reference (`{assetRef}`) | `--value '{"assetRef":"Assets/Path/X.prefab"}'` | `set_property` |
| Wire a scene-object reference (`{sceneRef}`) | `--value '{"sceneRef":"/Path/To/Object"}'` | `set_property` |
| Wire a sub-asset (Sprite in atlas) | `--value '{"assetRef":"Assets/Sheet.png","subAsset":"Idle_0"}'` | `set_property` |
| Wire a sibling component (self) | `--value '{"self":true,"component":"PlayerCtl"}'` | `set_property` |
| Wire a descendant component | `--value '{"selfChild":"Visuals/Hand","component":"SpriteRenderer"}'` | `set_property` |
| Replace an array | `--value '[v1, v2, ...]'` | `set_property` |
| Append at index N to a list | `--property entries --value '{"_size":N+1,"N":<value>}'` | `set_property` |
| Update one element in a list | `--property entries[N] --value <JSON>` (Unity-internal `entries.Array.data[N]` rewrite) | `set_property` |
| Set a Material color/float/texture/keyword | `set-material-property --asset <.mat> (--property NAME --value JSON \| --keyword K --enable bool)` | `set_material_property` |
| Reassign a Material's shader | `set-material-shader --asset <.mat> --shader "URP/Unlit"` | `set_material_shader` |
| Set a ParticleSystem module field (`main.startLifetime`, `emission.rateOverTime`, `shape.angle`, …) | `set-particle-property (--scene-object <p> \| --asset <prefab> [--child-path <SUB>]) --property MODULE.FIELD --value <JSON>` | `set_particle_property` |
| Adjust a uGUI element's RectTransform | `set-rect-transform (--scene-object <p> \| --asset <prefab> [--child-path <SUB>]) [--anchor X] [--size WxH]` | `set_rect_transform` |

## Edit — GameObject lifecycle

| Task | Command | Kind |
|---|---|---|
| Rename a scene GameObject | `rename --scene-object <path> --name <new>` | `rename_gameobject` |
| Rename a prefab root | `rename --asset <prefab> --name <new>` | `rename_gameobject` |
| Rename a child inside a prefab | `rename --asset <prefab> --child-path <SUB> --name <new>` | `rename_gameobject` |
| Move a scene GameObject under a new parent | `reparent --scene-object <path> --new-parent <new>` | `reparent_gameobject` |
| Move a scene GameObject to scene root | `reparent --scene-object <path>` (omit `--new-parent`) | `reparent_gameobject` |
| Reparent inside a prefab | `reparent --asset <prefab> --child-path <SUB> --new-parent <REL>` | `reparent_gameobject` |
| Duplicate a scene GameObject | `duplicate --scene-object <path> [--name <new>]` | `duplicate` |
| Duplicate a prefab/asset file | `duplicate --asset <path> --name <new>` | `duplicate` |
| Delete a scene GameObject | `delete-gameobject --scene-object <path>` | `delete_gameobject` |
| Delete a child inside a prefab | `delete-gameobject --asset <prefab> --child-path <SUB>` | `delete_gameobject` |

## Build / save / refresh

| Task | Command | Kind |
|---|---|---|
| Persist scene mutations to disk | `save-assets` (covers BOTH scenes AND assets) | `save_assets` |
| Save the active scene only | `save-scene` (rare — prefer save-assets) | `save_scene` |
| Save scene-as to a new path | `save-scene --path Assets/Scenes/X.unity` | `save_scene` |
| Force AssetDatabase refresh | `refresh-assets` (auto-prepended before compile-gated commands) | `refresh_assets` |
| Force-reimport a stuck .cs file | `reimport-script --path Assets/Foo.cs` | `reimport_scripts` |
| Force-reimport every .cs in a folder | `reimport-scripts --path Assets/Scripts` | `reimport_scripts` |
| Save a configured scene object as a NEW prefab | `save-as-prefab --scene-object <path> --path Assets/Prefabs --name X` | `save_as_prefab` |
| Open an existing scene | `open-scene "Assets/Scenes/X.unity" [--mode single\|additive]` | `open_scene` |

## Canvas (uGUI) work — see the `dreamer-ugui` skill

| Task | Command | Kind |
|---|---|---|
| Build / replace a Canvas UI tree | `create-ui-tree --json '{...}'` (modes: create/append/replace-children/replace-self) | `create_ui_tree` |
| Inspect a Canvas tree | `inspect-ui-tree --target <scene path>` | `inspect_ui_tree` |

## AnimationClip authoring — `com.dreamer.agent-bridge.animation` add-on

| Task | Command | Kind |
|---|---|---|
| Create a new .anim clip | `create-animation-clip --name X [--path Assets/Animations] [--frame-rate 30] [--loop true]` | `create_animation_clip` |
| Add / replace a float curve | `set-animation-curve --asset <.anim> [--target SUB] --component <FQN> --property <m_Field.x> --keys '[{"t":0,"v":0,"interp":"linear"},{"t":1,"v":1,"interp":"linear"}]'` | `set_animation_curve` |
| List all curve bindings on a clip | `inspect-animation-clip --asset <.anim>` | `inspect_animation_clip` |
| **Verify a curve numerically (sample [{t,v},...] table)** | `sample-animation-curve --asset <.anim> [--target SUB] --component <FQN> --property <m_Field.x> [--samples 30]` | `sample_animation_curve` |
| Remove a curve binding | `delete-animation-curve --asset <.anim> [--target SUB] --component <FQN> --property <m_Field.x>` | `delete_animation_curve` |

After every `set-animation-curve`, run `sample-animation-curve` with the same triple to read the curve back as numbers — that's how you verify the tangents do what you intended (especially for `interp:"auto"` which can overshoot).

## Diagnostics

| Task | Command | Kind |
|---|---|---|
| Daemon + Unity status | `status` | (daemon GET) |
| Recent commands across queue (multi-agent visibility) | `activity --since 2m` | (daemon GET) |
| Shader compile errors / warnings | `shader-status [--asset <shader>]` | `shader_status` |
| Force-focus Unity (Windows: needed when stalled) | `focus-unity` | (CLI helper) |

## Escape hatches (last resort — surface as gap to user instead)

| Task | Command | Kind |
|---|---|---|
| Run an Editor menu item | `execute-menu-item "GameObject/UI/Canvas"` | `execute_menu_item` |
| Invoke a static C# method | `execute-method --type <FQN> --method <name>` | `execute_method` |

If you find yourself reaching for these, check `help` first — there's almost always a first-class command. If there genuinely isn't, **surface the gap to the user** rather than hacking around it. NEVER hand-edit `.unity` / `.prefab` / `.asset` / `.meta` YAML.

## See also

- `./bin/dreamer help conventions` — universal flags (`--wait`, `--label`, `--allow-playmode`, focus policy), target forms, path syntax, value formats, play-mode gating, multi-agent rules, **common pitfalls**.
- `./bin/dreamer help <kind>` — full schema for one command (args with CLI flags, constraints, examples, pitfalls).
- [property-values.md](property-values.md) — extended `--value` catalogue.
- [materials-shaders.md](materials-shaders.md) — material / shader workflow.
