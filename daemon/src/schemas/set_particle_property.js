'use strict';

module.exports = {
  kind: 'set_particle_property',
  summary:
    "Set a ParticleSystem module property. CLI verb: `set-particle-property`. " +
    "ParticleSystem exposes its config through C# wrapper structs (MainModule, EmissionModule, ...) " +
    "that the generic `set-property` can't reach. Use this command for any module field — " +
    "`main.*`, `emission.*`, `shape.*`, `velocityOverLifetime.*`, `noise.*`, `trails.*`, etc. " +
    "Top-level scalar fields without a module prefix (e.g. just `lengthInSec`) also work.",
  requirements: null,
  args: {
    sceneObjectPath: {
      type: 'string',
      cli: '--scene-object',
      description: 'Scene-object path to the GameObject hosting the ParticleSystem.',
    },
    assetPath: {
      type: 'string',
      cli: '--asset',
      description: 'Path to a prefab `.prefab`. Combine with `--child-path` if the ParticleSystem lives on a nested child.',
    },
    guid: {
      type: 'string',
      cli: '--asset (GUID form)',
      description: 'Asset GUID — alternative to assetPath.',
    },
    childPath: {
      type: 'string',
      cli: '--child-path',
      description: 'Sub-path inside the prefab (e.g. "Visuals/Smoke") — only meaningful with --asset.',
    },
    propertyPath: {
      type: 'string',
      cli: '--property',
      description:
        'Module-prefixed field path. First segment is the module API name (`main`, `emission`, `shape`, ' +
        '`velocityOverLifetime`, `limitVelocityOverLifetime`, `inheritVelocity`, `lifetimeByEmitterSpeed`, ' +
        '`forceOverLifetime`, `colorOverLifetime`, `colorBySpeed`, `sizeOverLifetime`, `sizeBySpeed`, ' +
        '`rotationOverLifetime`, `rotationBySpeed`, `externalForces`, `noise`, `collision`, `trigger`, ' +
        '`subEmitters`, `textureSheetAnimation`, `lights`, `trails`, `customData`). Examples: ' +
        '"main.startLifetime", "emission.rateOverTime", "shape.angle", "noise.strength".',
    },
    value: {
      type: 'any',
      cli: '--value',
      description:
        'Field value. Bare numbers (5 or 5.0) target MinMaxCurve fields as a constant — auto-sets ' +
        '`minMaxState=0 (Constant)` and assigns scalar+minScalar. Pass `{"min": N, "max": M}` for ' +
        'TwoConstants mode. For complex curves, set sub-fields explicitly via "main.startLifetime.scalar" / ' +
        '".minMaxState". Vector/Color/bool/string follow the same JSON shapes as `set-property`.',
    },
  },
  constraints: [
    { rule: 'atLeastOne', fields: ['sceneObjectPath', 'assetPath', 'guid'] },
  ],
  result: {
    type: 'object',
    fields: {
      set: { type: 'boolean' },
      propertyPath: { type: 'string' },
      resolvedPath: { type: 'string', description: 'The actual SerializedProperty path used (after module-name rewrite).' },
      componentType: { type: 'string' },
      target: { type: 'string' },
      assetPath: { type: 'string' },
    },
  },
  examples: [
    {
      title: 'Set startLifetime on the main module (constant 5 seconds)',
      cli: './bin/dreamer set-particle-property --scene-object Explosion --property main.startLifetime --value 5 --wait',
      args: { sceneObjectPath: 'Explosion', propertyPath: 'main.startLifetime', value: 5 },
    },
    {
      title: 'Randomized startSpeed between 2 and 8 (TwoConstants mode)',
      cli: './bin/dreamer set-particle-property --scene-object Explosion --property main.startSpeed --value \'{"min":2,"max":8}\' --wait',
      args: { sceneObjectPath: 'Explosion', propertyPath: 'main.startSpeed', value: { min: 2, max: 8 } },
    },
    {
      title: 'Toggle the emission module off',
      cli: './bin/dreamer set-particle-property --scene-object Smoke --property emission.enabled --value false --wait',
      args: { sceneObjectPath: 'Smoke', propertyPath: 'emission.enabled', value: false },
    },
    {
      title: 'Cone shape angle',
      cli: './bin/dreamer set-particle-property --scene-object Fountain --property shape.angle --value 25 --wait',
      args: { sceneObjectPath: 'Fountain', propertyPath: 'shape.angle', value: 25 },
    },
    {
      title: 'Edit a ParticleSystem nested inside a prefab',
      cli: './bin/dreamer set-particle-property --asset Assets/PFX/Explosion.prefab --child-path Sparks --property emission.rateOverTime --value 200 --wait',
      args: { assetPath: 'Assets/PFX/Explosion.prefab', childPath: 'Sparks', propertyPath: 'emission.rateOverTime', value: 200 },
    },
    {
      title: 'Top-level field (no module prefix)',
      cli: './bin/dreamer set-particle-property --scene-object Smoke --property lengthInSec --value 10 --wait',
      args: { sceneObjectPath: 'Smoke', propertyPath: 'lengthInSec', value: 10 },
    },
  ],
  pitfalls: [
    'DO NOT try `set-property` on ParticleSystem module fields — `main.startLifetime` resolves to nothing because `main` is a property accessor returning a value-type wrapper struct, not a serialized field. Use this command instead.',
    'Module API names are NOT the serialized names. Schema does the rewrite for you (`main` → `InitialModule`, `limitVelocityOverLifetime` → `ClampVelocityModule`, `textureSheetAnimation` → `UVModule`, `subEmitters` → `SubModule`). Always write the API name (`main.X`), not the serialized name.',
    'A bare number (`--value 5`) sets a MinMaxCurve to constant mode. A `{"min":N,"max":M}` object sets TwoConstants mode. For curve-mode (animated over particle lifetime), drill into sub-fields explicitly: `main.startLifetime.scalar`, `main.startLifetime.minMaxState` (0=Constant, 1=Curve, 2=TwoCurves, 3=TwoConstants), `main.startLifetime.maxCurve`.',
    'Color-over-lifetime (`colorOverLifetime.color`) is a MinMaxGradient, not a MinMaxCurve — different serialization. Not yet auto-handled; set sub-fields directly if needed.',
    'After editing a prefab\'s ParticleSystem, run `save-assets --wait` to flush. Scene-object edits also need save (handled by save-assets in the same call).',
  ],
};
