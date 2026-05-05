'use strict';

const { commonArgs } = require('./_common');

module.exports = {
  kind: 'setup_particle_material',
  summary: 'Ensure a ParticleSystemRenderer in a prefab has a usable material assigned. If the renderer already has a material, this is a no-op (set --force to overwrite). Otherwise creates a placeholder material at `Assets/Materials/{prefabName}_Particle.mat` with a particle-friendly Unlit shader, white tint, and additive blend, then assigns it to every ParticleSystemRenderer in the prefab subtree. Closes the "particles are invisible / magenta" gap that hits every freshly-created ParticleSystem prefab.',
  requirements: null,
  args: {
    ...commonArgs.target(['asset', 'guid']),
    name: {
      type: 'string',
      cli: '--name',
      description: 'Override material asset name. Default: `{prefabStem}_Particle`.',
    },
    path: {
      type: 'string',
      cli: '--path',
      description: 'Folder under Assets/ to put the material in. Default: `Assets/Materials`. Created if missing.',
    },
    shader: {
      type: 'string',
      cli: '--shader',
      description: 'Shader to set on the new material. Default: tries `Particles/Standard Unlit`, then `Universal Render Pipeline/Particles/Unlit`, then `Sprites/Default`. Pass an explicit name to skip the search.',
    },
    color: {
      type: 'string',
      cli: '--color',
      description: 'Tint color hex `#RRGGBB` or `#RRGGBBAA`. Default `#FFFFFFFF` (white).',
    },
    texture: {
      type: 'string',
      cli: '--texture',
      description: 'Asset path to a texture to set as `_MainTex`. Optional — leave blank for solid-color particles.',
    },
    blendMode: {
      type: 'string',
      cli: '--blend',
      enum: ['additive', 'alpha', 'multiply', 'opaque'],
      description: 'Blend mode preset for the Particles/Standard Unlit shader (sets `_Mode`). Default `additive` (good for sparks, fire, energy).',
    },
    force: {
      type: 'boolean',
      cli: '--force',
      description: 'Replace the existing material if the renderer already has one. Default false (no-op when material is already assigned).',
    },
  },
  constraints: [commonArgs.targetAtLeastOne(['asset', 'guid'])],
  result: {
    type: 'object',
    fields: {
      created: { type: 'boolean', description: 'True if a new material asset was created on disk. False if an existing one was reused or the renderer was already set up.' },
      assigned: { type: 'boolean', description: 'True if any renderer received the material this call. False if all renderers were already set up.' },
      materialPath: { type: 'string', description: 'Path of the material that ended up assigned.' },
      shader: { type: 'string', description: 'Shader name on the assigned material.' },
      renderers: {
        type: 'array',
        description: 'List of `{ path, hadMaterial, assigned }` per ParticleSystemRenderer in the prefab subtree. `path` is the GameObject path relative to the prefab root.',
      },
      hint: { type: 'string', description: 'Next-step suggestion for the agent.' },
    },
  },
  examples: [
    {
      title: 'First-time setup: assigns default white-additive material',
      cli: './bin/dreamer setup-particle-material --asset Assets/FX/Explosion.prefab --wait',
      args: { assetPath: 'Assets/FX/Explosion.prefab' },
    },
    {
      title: 'Custom name + texture for a fire effect',
      cli: './bin/dreamer setup-particle-material --asset Assets/FX/Fire.prefab --name FireMat --texture Assets/Textures/flame.png --color "#FFAA22" --blend additive --wait',
      args: { assetPath: 'Assets/FX/Fire.prefab', name: 'FireMat', texture: 'Assets/Textures/flame.png', color: '#FFAA22', blendMode: 'additive' },
    },
    {
      title: 'Force-replace an existing material',
      cli: './bin/dreamer setup-particle-material --asset Assets/FX/Spark.prefab --shader "Sprites/Default" --force --wait',
      args: { assetPath: 'Assets/FX/Spark.prefab', shader: 'Sprites/Default', force: true },
    },
  ],
  pitfalls: [
    'Only handles ParticleSystemRenderer (the renderer attached to a ParticleSystem). For TrailRenderer / LineRenderer assignment, use `set-property` on the specific component.',
    'Particles/Standard Unlit ships with the Built-in render pipeline. On URP/HDRP projects pass `--shader "Universal Render Pipeline/Particles/Unlit"` (or the HDRP equivalent) explicitly — the auto-fallback covers the most common cases but a custom pipeline-specific shader is more reliable.',
    'No-op by default if the renderer already has a material. Pass `--force` to replace — useful when you want to swap blend modes or textures without going through `set-material-property`.',
    'Reuses an existing material at the target path rather than overwriting it (so re-running this command is safe and cheap). Pass `--force` AND a different `--name` to create a fresh one.',
  ],
  seeAlso: [
    './bin/dreamer help create_material      — generic material creation; use this for non-particle materials.',
    './bin/dreamer help capture_particle     — pair with `--auto-material` to set up the material AND capture in one call.',
    './bin/dreamer help set_material_property — fine-tune material properties after setup.',
  ],
};
