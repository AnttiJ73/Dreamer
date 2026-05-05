---
name: dreamer-fx
description: Iterate on Unity ParticleSystem effects with visual feedback — `capture-particle` spawns a particle prefab into a sandboxed preview scene, runs `ParticleSystem.Simulate(t)` deterministically at N timestamps, and renders each frame to PNG so the LLM can SEE how the effect looks at t=0, t=0.5s, t=1.0s, etc. Use whenever the task involves particle systems, VFX, explosions, sparks, trails, magic effects, fire, smoke, dust, debris, ParticleSystem properties, emission rates, lifetimes, shapes, color over lifetime, or any "how does this effect look?" question. Activated by mentions of particles, VFX, effects, ParticleSystem, emission, burst, explosion, spark, trail.
---

# Dreamer — FX (Particle) add-on

Optional add-on. Closes the **visual-feedback gap** for VFX iteration: without it, an agent editing particle properties can only guess what it looks like. With it, the loop is:

```
set-particle-property → capture-particle → Read PNGs → judge → repeat
```

Asset-only in Phase 1 — captures from a `.prefab` containing one or more `ParticleSystem` components. Instantiates into a `PreviewRenderUtility` scene; the user's active scene is untouched.

If you forget the verb, run `./bin/dreamer search "particles"` (or `"vfx"`, `"explosion"`, `"simulate effect"`).

## Commands

| Command | Use for |
|---|---|
| `capture-particle` | **Spawn + simulate + render.** Multi-frame screenshots at deterministic timestamps. |
| `set-particle-property` | Edit module fields (emission, shape, lifetime, color over lifetime, …). **Ships in core, not the add-on** — works without dreamer-fx installed. |

## Hard rules

- **Always pass `--wait`** — you need the PNG paths before you can Read them.
- **Read every returned PNG.** The whole point is visual feedback. `result.frames[i].path` → Read tool.
- **Use `--seed N` for diffing.** Without a fixed seed, two consecutive captures of the same prefab produce different particles (random emission), which drowns out the actual change you made. Pick any int (e.g. 42); use the same value across the iteration session.
- **Pass `--duration` for looping systems.** `main.loop=true` means there's no natural end; the command picks a default but it may not match the cycle you want to inspect.
- **Phase 1 limits**: prefab path only (no scene-object), no VFX Graph (`UnityEngine.VFX.VisualEffect`). Workaround for scene-object tweaking: duplicate the live PS into a temporary prefab, iterate there, copy values back when satisfied.

## The iteration loop

```bash
# 1. See what you have
./bin/dreamer capture-particle --asset Assets/FX/Explosion.prefab --seed 42 --wait
# Read DreamerScreenshots/particle-Explosion-...-t0000.png ... t2000.png

# 2. Tweak something
./bin/dreamer set-particle-property --asset Assets/FX/Explosion.prefab \
  --component ParticleSystem --property emission.rateOverTime --value 100 --wait

# 3. Compare
./bin/dreamer capture-particle --asset Assets/FX/Explosion.prefab --seed 42 --wait
# Read the new PNGs side-by-side with the previous ones (same seed → same RNG)

# 4. Repeat 2-3 until it looks right.
# 5. Save: the prefab IS the source of truth — no extra save step needed.
```

The seed-pinned same-time PNG sequence is what makes diff-by-eye productive.

## Frame timing

Three ways to control which timestamps get captured:

| Mode | Args | Behavior |
|---|---|---|
| Even N frames over auto-duration | `--frames 5` | Default. Duration auto-picked from `main.duration` (or 2.0s if loop). 5 frames evenly spread t=0…t=duration. |
| Even N frames over explicit duration | `--frames 5 --duration 3.0` | 5 frames at t = 0, 0.75, 1.5, 2.25, 3.0. |
| Explicit non-uniform sample times | `--times "[0,0.05,0.15,0.5,1.5]"` | Use for burst-falloff effects where most action is near t=0. Overrides `--frames`+`--duration`. |

For a one-shot effect like an explosion, `--times "[0, 0.05, 0.15, 0.4, 1.0]"` typically gives more useful detail than 5 evenly-spaced frames (most pixels change in the first 0.5s).

For a continuous effect (smoke, fire), even spacing across one loop cycle is usually fine.

## Camera + framing

The camera **auto-frames to the union of particle bounds across all sample times** — so a frame where particles spread far won't push the early-frame particles offscreen.

| Arg | Default | Notes |
|---|---|---|
| `--angle front\|back\|left\|right\|top\|bottom\|iso\|iso-front` | `front` | Same set as `screenshot-prefab`. |
| `--size WIDTHxHEIGHT` | `512x512` | Up to 4096x4096. Big sizes are slower but useful for fine detail. |
| `--bg "#RRGGBB"` or `"#RRGGBBAA"` | solid black | `--bg "#202020"` for a dark grey backdrop. |
| `--transparent` | off | Alpha-0 background. Useful for compositing the capture onto a different backdrop. |

## Reading the result

```json
{
  "captured": true,
  "assetPath": "Assets/FX/Explosion.prefab",
  "rootName": "Explosion",
  "particleSystems": 3,            // total PS components in the subtree
  "loops": false,
  "duration": 2.0,
  "width": 512, "height": 512,
  "bounds": { "center": [...], "size": [...] },  // what the camera was framed to
  "frames": [
    { "time": 0.0, "path": "DreamerScreenshots/particle-Explosion-XX-NN-t00000.png", "byteCount": 12345 },
    { "time": 0.5, "path": "DreamerScreenshots/particle-Explosion-XX-NN-t00500.png", "byteCount": 23456 },
    ...
  ]
}
```

`time` is the simulated seconds-since-start the frame represents. The `t<msec>` suffix in the filename is the same number, padded for sortability.

## Common edits to capture-iterate against

| Want to change | Property | Notes |
|---|---|---|
| How many particles | `emission.rateOverTime` (continuous) or `emission.bursts` (one-shot) | Default rate often too low/high; halve or double and re-capture. |
| How long each particle lives | `main.startLifetime` | Longer lifetime = particles stay visible longer; usually shifts visual centre forward. |
| Emission area / spread | `shape.angle`, `shape.radius`, `shape.shapeType` | Bigger angle = wider cone; bigger radius = more spread at base. |
| Initial speed / direction | `main.startSpeed`, `main.startSpeedMultiplier` | Doubles fast — try 0.5x or 2x as first move. |
| Color over time | `colorOverLifetime` (gradient) | Gradient — agent edits via set-particle-property require the gradient JSON shape; usually faster to tweak in inspector then capture. |
| Scale of each particle | `main.startSize` | Often the right knob when "looks too dense" or "feels too sparse". |
| Gravity / falloff | `main.gravityModifier`, `forceOverLifetime` | Negative gravity = floats up (smoke); positive = falls (debris). |

`set-particle-property` reaches all of these. Run `./bin/dreamer help set_particle_property` for the full property syntax.

## When the add-on is missing

If `capture-particle` returns "Unknown command kind: capture_particle", tell the user:

> To enable particle-capture, run: `./bin/dreamer addon install fx`

`set-particle-property` works without the addon (it ships in core), but it's blind — you can edit, you just can't see the result without running the project in Play Mode.

## Build-time gotchas

- **PreviewRenderUtility runs the built-in render path.** Effects relying on URP/HDRP-only features (custom passes, certain Shader Graph nodes that compile per-pipeline) may render slightly differently in capture vs the user's actual game. Capture is for *iteration direction*, not pixel-perfect production preview. If a captured frame looks wrong but plays correctly in-game, trust the in-game render.
- **`useAutoRandomSeed=true` is the default.** Capture forces it to false so seeds are honoured, but this also means the *first* capture of a prefab differs from how it'd play in-game (which has a fresh random seed each time). Doesn't matter for iteration; matters if comparing capture to recorded gameplay footage.
- **Sub-emitters and trails are included.** `Renderer.bounds` walks the whole subtree, so trail Renderers and sub-emitter chains contribute to bounds + render correctly.
- **VFX Graph (`UnityEngine.VFX.VisualEffect`)** is a different system entirely — `capture-particle` doesn't support it. Out of scope for Phase 1.
- **Scene-object capture** (live ParticleSystem in the active scene) isn't supported; would need destructive simulate-then-restore which is risky during Play Mode. Workflow: duplicate the live PS into a temporary prefab, iterate there with `capture-particle`, copy values back to the live one when satisfied.
- **Output directory**: `DreamerScreenshots/` at project root. Self-ignoring `.gitignore` is auto-created so PNGs stay out of source control but visible to VS Code's file tree.
