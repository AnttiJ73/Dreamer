# Dreamer Test Prompts

These are prompts designed to test the full Dreamer toolset. Each prompt should be given to Claude in a Unity project that has Dreamer installed.

---

## Test 1: RPG Inventory System

Create an RPG inventory system. I need an item data system where each item has a name, description, icon, how many can stack, and a gold value. Create three items: a Health Potion, an Iron Sword, and a Wooden Shield.

Make an inventory slot prefab with a background image, an icon image on top of that, a stack count label in the corner, and a button so you can click it. The slot should have a script that knows about all these UI pieces and which item it's holding.

Build an inventory panel in the scene with a canvas, a panel with a title that says "Inventory", a close button with an X, and a grid of 6 inventory slots. There should be a manager script on the panel that knows about the grid, the title, the close button, and has the slot prefab assigned so it can create more slots later. Set the grid to 80x80 cells with 4 pixel spacing.

Put the Health Potion on the first two slots and the Iron Sword on the third.

---

## Test 2: 3D Platformer Level

Build a basic 3D platformer level. Create a player prefab with physics, a collider, and a movement script that has settings for move speed, jump force, a ground check point, and a camera reference. The player should have a child object called "GroundCheck" below its feet and another called "CameraTarget" above its head.

Create a moving platform prefab with a collider and a mover script that has a start position, end position, speed, and whether it should go back and forth.

Create a checkpoint prefab with a trigger collider, an ID number, a spawn point child object, and a slot for a particle effect prefab.

Create a death zone prefab with a big trigger collider and a reference to which checkpoint to respawn at.

Set up a new scene called "Level1" with the player at position (0, 2, 0), three moving platforms at different heights, two checkpoints, and a death zone below everything. Connect the death zone to the first checkpoint. Hook up the player's ground check to its child object and its camera to the scene camera.

---

## Test 3: Enemy Wave Spawner

Create an enemy wave spawning system with three enemy types.

A Goblin with physics, a collider, navigation, and a stats script with health, damage, speed, and attack range. Give it a health bar made of a small canvas with a background bar and a fill bar. Wire the health bar references in the script. Set the goblin to 50 health, 10 damage, speed 3, range 2.

A Skeleton with the same setup but 30 health, 15 damage, speed 4, range 1.5.

An Ogre with the same setup but 200 health, 30 damage, speed 1.5, range 3.

Create a wave spawner prefab with a manager script that has a slot for each enemy type, a spawn point, spawn interval, and max enemies alive. Add a spawn point child at (0, 0, 5).

Put the spawner in the scene, set it to spawn every 2 seconds with max 10 enemies, and assign all three enemy prefabs. Duplicate the spawner, move the copy to (20, 0, 0), and rename it "WaveSpawner_East".

---

## Test 4: UI Menu System

Build a complete main menu. Create a new scene called "MainMenu" with a canvas that scales with screen size.

Under the canvas, build three panels:

A main menu panel with a game title, Play button, Settings button, and Quit button. Each button needs a text label.

A settings panel with a "Settings" title, a volume slider with a label, a placeholder for resolution (just an image and text), a fullscreen toggle with a label, and a Back button.

A credits panel with a "Credits" title, a scrollable text area for the credits content, and a Back button.

Create a UI manager script with references to all three panels, the play button, settings button, quit button, and both back buttons. Put it on the canvas and set all the references.

---

## Test 5: Weapon System with Data Assets

Create a weapon system where each weapon's stats are defined as a data asset. Each weapon should have a name, damage, fire rate, range, ammo capacity, an icon, and a projectile prefab.

Create a bullet prefab with physics (no gravity), a small collider, a trail effect, and a projectile script with speed, lifetime, and damage settings.

Create a rocket prefab with the same components plus a light and a child "SmokeTrail" object. Set the rocket to speed 15, lifetime 4, damage 50.

Create three weapon data assets:
- Pistol: 10 damage, fast fire rate, medium range, 12 ammo, uses the bullet
- Shotgun: 25 damage, slow fire rate, short range, 8 ammo, uses the bullet
- Rocket Launcher: 100 damage, very slow fire rate, long range, 4 ammo, uses the rocket

Create a weapon holder prefab with a controller script that has the current weapon data, a fire point child, a muzzle flash slot, and current ammo tracking. Put the fire point at (0, 0, 1).

Place the weapon holder in the scene and give it the pistol.

---

## Test 6: Vehicle with Deep Nesting

Test building a complex prefab with lots of nested parts. Create a vehicle prefab with physics and a controller script with speed, turn speed, and health settings.

Add four wheel children to the vehicle: front-left, front-right, back-left, back-right, each at their appropriate corner positions. Add wheel physics to each one.

Add a "Body" child with a mesh renderer and a "DriverSeat" child inside the body.

Add a "Turret" child with a turret controller script that has rotation speed and damage settings. Under the turret, add a "Barrel" child, and under the barrel add a "MuzzlePoint" child.

Set the vehicle speed to 20, turn speed to 45, health to 500. Set the turret rotation to 90 and damage to 25.

Duplicate the whole vehicle, rename it "HeavyTank", and change its health to 1000, speed to 10, and turret damage to 75.

Put both vehicles in the scene at different spots and inspect them to make sure the nested structure looks right.
