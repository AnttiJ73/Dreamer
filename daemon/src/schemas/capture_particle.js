'use strict';

const { commonArgs } = require('./_common');

module.exports = {
  kind: 'capture_particle',
  summary: 'Spawn a particle-system source (prefab OR live scene GameObject) into a sandboxed preview scene, run `ParticleSystem.Simulate(t)` deterministically at N timestamps, and compose all frames into ONE grid PNG (left-to-right, top-to-bottom, with `t=0.50s` timestamp labels above each cell). Closes the visual-feedback gap for VFX iteration: edit a property with `set-particle-property`, capture again, Read the single grid PNG to judge the change at every moment of the effect. Scene mode clones the GameObject into the preview scene — the live scene object is NEVER touched and never flickers. Output lands in `DreamerScreenshots/`.',
  requirements: null,
  args: {
    ...commonArgs.target(['asset', 'guid', 'scene']),
    frames: {
      type: 'integer',
      cli: '--frames',
      description: 'Number of timestamps to capture, evenly distributed across `duration`. Default 5. Use 1 for a mid-effect single shot. Range 1..60.',
    },
    duration: {
      type: 'number',
      cli: '--duration',
      description: 'Total simulated seconds the capture spans. Default = root system\'s `main.duration`, falling back to 2.0 if loop=true. Frames are spaced evenly from t=0 to t=duration.',
    },
    times: {
      type: 'array',
      cli: '--times',
      description: 'Explicit non-uniform sample times (seconds). When set, overrides `frames`+`duration`. Use for capturing specific moments — e.g. `[0, 0.1, 0.5, 1.0, 2.0]` to focus on the burst then the falloff.',
    },
    width: {
      type: 'integer',
      cli: '--width',
      description: 'Output PNG width in pixels (default 512). Range 1..4096. Combined --size W x H also accepted.',
    },
    height: {
      type: 'integer',
      cli: '--height',
      description: 'Output PNG height (default 512). Range 1..4096.',
    },
    angle: {
      type: 'string',
      cli: '--angle',
      enum: ['front', 'back', 'left', 'right', 'top', 'bottom', 'iso', 'iso-front'],
      description: 'Camera orientation. Default `front`. Camera auto-frames to the union of particle bounds across all sample times.',
    },
    backgroundColor: {
      type: ['string', 'object'],
      cli: '--bg',
      description: 'Background color. Hex string `"#000000"` or `"#RRGGBBAA"`, or `{r,g,b,a}` object (0..1). Default solid black. Use `--transparent` for alpha-0 background instead.',
    },
    transparent: {
      type: 'boolean',
      cli: '--transparent',
      description: 'Render with a transparent (alpha=0) background instead of `backgroundColor`. Useful for compositing the capture onto a different backdrop.',
    },
    seed: {
      type: 'integer',
      cli: '--seed',
      description: 'Force `randomSeed` on every ParticleSystem in the prefab subtree so re-captures are pixel-identical. Default: leave whatever the prefab has (deterministic only if all PS already had useAutoRandomSeed=false).',
    },
    individualFrames: {
      type: 'boolean',
      cli: '--individual-frames',
      description: 'Also save each frame as a separate PNG alongside the grid composite. Default: false (grid-only). Use this when you want to compare the same timestamp across two captures via image-diff tools that need separate files.',
    },
    gif: {
      type: 'boolean',
      cli: '--gif | --no-gif',
      description: 'Emit an animated GIF alongside the grid PNG (default: true when frames >= 2). The GIF loops indefinitely at a frame rate derived from `duration`. Quantized to 256 colors via median-cut. Pass `--no-gif` to skip.',
    },
    gifDelayMs: {
      type: 'integer',
      cli: '--gif-delay-ms',
      description: 'Per-frame delay in milliseconds for the GIF. Default: `duration * 1000 / (frames - 1)` so the GIF spans the same simulated time as the capture. Min effective delay is 20ms (50 fps cap from the GIF format).',
    },
    gifLoop: {
      type: 'integer',
      cli: '--gif-loop',
      description: 'GIF loop count. Default 0 = infinite. Set to N for a finite loop count.',
    },
    autoMaterial: {
      type: 'boolean',
      cli: '--auto-material',
      description: 'If the prefab\'s ParticleSystemRenderer has no material assigned, run `setup-particle-material` first to create + assign a default white-additive placeholder. Saves a manual round-trip when capturing a freshly-created particle prefab. No-op if a material is already set.',
    },
  },
  constraints: [commonArgs.targetAtLeastOne(['asset', 'guid', 'scene'])],
  result: {
    type: 'object',
    fields: {
      captured: { type: 'boolean' },
      path: { type: 'string', description: 'Path to the GRID composite PNG — single image with all frames laid out left-to-right, top-to-bottom, each cell labelled `t=X.XXs`. Open this with the Read tool.' },
      assetPath: { type: 'string' },
      rootName: { type: 'string' },
      particleSystems: { type: 'integer', description: 'Total ParticleSystem components found in the subtree.' },
      loops: { type: 'boolean', description: 'True if any system in the prefab has `main.loop=true`.' },
      duration: { type: 'number' },
      cellWidth: { type: 'integer', description: 'Width of one frame cell (= --width).' },
      cellHeight: { type: 'integer' },
      gridWidth: { type: 'integer', description: 'Total composite PNG width (cols × cellWidth + gutters + label strips).' },
      gridHeight: { type: 'integer' },
      cols: { type: 'integer' },
      rows: { type: 'integer' },
      frameCount: { type: 'integer' },
      bounds: {
        type: 'object',
        description: 'Union of particle Renderer.bounds across all sample times — what the camera was framed to. `{ center: [x,y,z], size: [w,h,d] }`.',
      },
      frames: {
        type: 'array',
        description: 'Per-frame metadata: `{ time, row, col, path?, byteCount? }`. `row`/`col` are the cell position in the grid (0-indexed, top-left origin). `path` only set when --individual-frames passed.',
      },
      byteCount: { type: 'integer', description: 'Size of the grid PNG in bytes.' },
      individualByteCount: { type: 'integer', description: 'Sum of per-frame PNGs (only > 0 when --individual-frames passed).' },
      gifPath: { type: 'string', description: 'Path to the animated GIF (only present when --gif is on AND frames >= 2).' },
      gifByteCount: { type: 'integer' },
    },
  },
  examples: [
    {
      title: '5 evenly-spaced frames over the system\'s natural duration',
      cli: './bin/dreamer capture-particle --asset Assets/FX/Explosion.prefab --wait',
      args: { assetPath: 'Assets/FX/Explosion.prefab' },
    },
    {
      title: 'Capture a live scene particle without prefabbing it',
      cli: './bin/dreamer capture-particle --scene-object "/Effects/Fire" --frames 5 --wait',
      args: { sceneObjectPath: '/Effects/Fire' },
      note: 'The live GameObject is cloned into a sandbox; your scene is never touched. Pair with `set-particle-property --scene-object …` for an in-scene tweak → capture loop without exporting to a prefab.',
    },
    {
      title: 'Tight burst-falloff sampling — most detail near t=0',
      cli: './bin/dreamer capture-particle --asset Assets/FX/Spark.prefab --times "[0,0.05,0.15,0.5,1.5]" --wait',
      args: { assetPath: 'Assets/FX/Spark.prefab', times: [0, 0.05, 0.15, 0.5, 1.5] },
    },
    {
      title: 'Iso angle, transparent background for compositing',
      cli: './bin/dreamer capture-particle --asset Assets/FX/Trail.prefab --angle iso --transparent --frames 8 --duration 3 --wait',
      args: { assetPath: 'Assets/FX/Trail.prefab', angle: 'iso', transparent: true, frames: 8, duration: 3 },
    },
    {
      title: 'Reproducible captures — fixed seed for diffing tweaks',
      cli: './bin/dreamer capture-particle --asset Assets/FX/Explosion.prefab --seed 42 --wait',
      args: { assetPath: 'Assets/FX/Explosion.prefab', seed: 42 },
    },
  ],
  pitfalls: [
    'The default output is ONE grid composite PNG (cell layout: 5 frames → 3×2, 10 frames → 5×2, otherwise near-square). Read just `result.path` — no need to chase per-frame files. Pass `--individual-frames` if you specifically need separate PNGs.',
    'Scene mode (`--scene-object`) clones the live GameObject into the preview scene — your live scene is never touched, never flickers. The clone inherits whatever component overrides + child values are currently in the scene. To capture the prefab\'s on-disk state instead, pass `--asset PATH` (different snapshot moment).',
    'Looping systems (`main.loop=true`) need an explicit `--duration` to bound the capture. Without one, the command picks a sensible default but it may not match your intent — pass the exact second-count of the cycle you want to inspect.',
    'For pixel-identical re-captures across edits, use `--seed N`. Without it, prefabs that have `useAutoRandomSeed=true` (the default) will produce different particles each run, making diff comparisons noisy.',
    'Camera auto-frames to the *union* of bounds across all sample times. If one frame has a far-flung outlier, every other frame will look small. To avoid: use `--times` with samples that share scale, or split into two captures.',
    'PreviewRenderUtility runs the built-in render path. Effects relying on URP/HDRP-only features (custom passes, Shader Graph nodes that compile per-pipeline) may render slightly differently in capture vs the user\'s actual game scene. The capture is for *iteration*, not pixel-perfect production preview.',
    'Sub-emitter chains and trails work — Renderer.bounds collection walks the whole subtree. But VFX Graph (`UnityEngine.VFX.VisualEffect`) is NOT supported by this command (different API entirely); planned for a future addition.',
  ],
  seeAlso: [
    './bin/dreamer help set_particle_property — edit module fields (emission rate, start lifetime, shape angle, …) before re-capturing.',
    './bin/dreamer help screenshot_prefab     — generic prefab preview (no simulation tick — use this for static prefabs).',
  ],
};
