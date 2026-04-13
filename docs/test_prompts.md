# Dreamer Test Prompts

These are prompts designed to test the full Dreamer toolset. Each prompt should be given to Claude in a Unity project that has Dreamer installed. Claude should use the `dreamer` CLI to accomplish everything.

---

## Test 1: RPG Inventory System

Create an RPG inventory system. I need a ScriptableObject called `ItemData` with fields for item name (string), description (string), icon (Sprite), stack size (int), and item value (int). Create three item instances: a Health Potion, an Iron Sword, and a Wooden Shield.

Then create an `InventorySlot` prefab that has an Image for the item icon background, a child Image for the actual icon, a child Text for the stack count, and a Button component. The InventorySlot should have a script with references to all of these UI elements and a field for the ItemData.

Create an `InventoryPanel` as a scene hierarchy with a Canvas, a Panel with a title text saying "Inventory", a close button with an X label, and a grid layout with 6 inventory slots. Add an InventoryManager script to the panel with references to the grid layout, the title text, the close button, and a field that holds the slot prefab. Set the grid cell size to 80x80 with 4 pixel spacing.

Assign the Health Potion ItemData to the first two slots and the Iron Sword to the third slot.

---

## Test 2: 3D Platformer Level Setup

Build a basic 3D platformer level structure. Create a `PlayerCharacter` prefab with a Rigidbody, CapsuleCollider, and a PlayerMovement script that has fields for move speed, jump force, ground check transform, and a reference to the main camera. The player should have a child empty object called "GroundCheck" positioned below the capsule and a child object called "CameraTarget" above it.

Create a `MovingPlatform` prefab with a BoxCollider and a PlatformMover script with fields for start position, end position (both Vector3), move speed (float), and a boolean for whether it should ping-pong.

Create a `Checkpoint` prefab with a BoxCollider set as trigger and a CheckpointController script with a checkpoint ID (int), a reference to a spawn point transform (child empty object called "SpawnPoint"), and a particle effect prefab reference.

Create a `DeathZone` prefab with a large BoxCollider trigger and a script that has a reference to a Checkpoint for the respawn location.

Set up a scene called "Level1" with the player at position (0, 2, 0), three moving platforms at different heights and positions, two checkpoints, and a death zone below the platforms. Wire the death zone's respawn reference to the first checkpoint. Set the player's ground check to its GroundCheck child and camera reference to the scene's Main Camera.

---

## Test 3: Enemy Wave Spawner

Create an enemy wave spawning system. I need three different enemy prefabs:

A "Goblin" with a Rigidbody, CapsuleCollider, NavMeshAgent component, an EnemyStats script (health, damage, speed, attackRange fields), and a HealthBar child that has a Canvas, a background Image, and a fill Image. Wire the HealthBar references in the script. Set the goblin stats to 50 health, 10 damage, 3 speed, 2 attack range.

A "Skeleton" with the same structure but 30 health, 15 damage, 4 speed, 1.5 attack range.

An "Ogre" with the same structure but 200 health, 30 damage, 1.5 speed, 3 attack range.

Create a `WaveSpawner` prefab with a WaveManager script that has a list-compatible setup with fields for each enemy prefab (goblin, skeleton, ogre), a spawn point transform, spawn interval (float), and max enemies alive (int). Give it a child "SpawnPoint" at position (0, 0, 5).

Put the WaveSpawner in the scene, set spawn interval to 2 seconds and max enemies to 10, and assign all three enemy prefabs. Duplicate the spawner, place the copy at (20, 0, 0), and rename it "WaveSpawner_East".

---

## Test 4: UI Menu System with Multiple Screens

Build a complete main menu system. Create a new scene called "MainMenu". In that scene, create a Canvas with a CanvasScaler set to scale with screen size.

Under the Canvas, create these panels:

A "MainMenuPanel" with a title text, a Play button, a Settings button, and a Quit button. Each button should have a child text label.

A "SettingsPanel" with a title "Settings", a volume slider (with a label text and a Slider component), a resolution dropdown placeholder (just an Image and Text for now), a fullscreen toggle (Toggle component with a label), and a Back button.

A "CreditsPanel" with a title "Credits", a scrollable text area (ScrollRect with a content child that has a Text component), and a Back button.

Create a UIManager script with references to all three panels, the play button, the settings button, the quit button, and the back buttons. Add it to the Canvas. Set all the references. Make sure the SettingsPanel and CreditsPanel start disabled (set active to false if that feature exists, otherwise note that it needs to be done manually).

---

## Test 5: ScriptableObject-Driven Weapon System

Create a weapon system driven by ScriptableObjects. First create a WeaponData ScriptableObject script with fields for weapon name (string), damage (int), fire rate (float), range (float), ammo capacity (int), weapon icon (Sprite), and a projectile prefab (GameObject).

Create a `Bullet` prefab with a Rigidbody (use gravity off), a SphereCollider, a TrailRenderer, and a Projectile script with speed (float), lifetime (float), and damage (int) fields.

Create a `Rocket` prefab with the same components but also add a Light component and a child "SmokeTrail" empty object. The Projectile script should have speed set to 15, lifetime to 4, and damage to 50.

Now create three WeaponData ScriptableObject instances:
- "Pistol" with 10 damage, 5 fire rate, 50 range, 12 ammo, and the Bullet as projectile
- "Shotgun" with 25 damage, 1.5 fire rate, 20 range, 8 ammo, and the Bullet as projectile  
- "RocketLauncher" with 100 damage, 0.5 fire rate, 100 range, 4 ammo, and the Rocket as projectile

Create a `WeaponHolder` prefab with a WeaponController script that has fields for current weapon data (WeaponData), fire point transform (child), muzzle flash prefab (GameObject), and current ammo (int). Add a child "FirePoint" at position (0, 0, 1).

Put the WeaponHolder in the scene and assign the Pistol weapon data to it.

---

## Test 6: Prefab Composition and Nesting

Test building complex prefabs with deep nesting. Create a "Vehicle" prefab with a Rigidbody and a VehicleController script (speed, turnSpeed, health fields).

Add four child objects to the Vehicle prefab: "WheelFL", "WheelFR", "WheelBL", "WheelBR", each positioned at appropriate corners (like -1/0/-1.5, 1/0/-1.5, -1/0/1.5, 1/0/1.5). Add a WheelCollider to each wheel child.

Add a "Body" child to the vehicle with a MeshRenderer and MeshFilter. Add a "DriverSeat" child under Body at position (0.3, 0.5, 0).

Add a "Turret" child to the vehicle with a TurretController script (rotation speed, damage fields). Under Turret, add a "Barrel" child at (0, 0.3, 0) and under Barrel add a "MuzzlePoint" child at (0, 0, 1.5).

Set the VehicleController speed to 20, turn speed to 45, health to 500. Set the TurretController rotation speed to 90 and damage to 25.

Duplicate the entire Vehicle prefab, rename the copy to "HeavyTank", and change its health to 1000, speed to 10, and turret damage to 75.

Instantiate both vehicles into the scene at different positions and inspect them to verify all the nested structure is correct.
