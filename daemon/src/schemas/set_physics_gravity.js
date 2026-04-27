'use strict';

module.exports = {
  kind: 'set_physics_gravity',
  summary:
    "Set the global physics gravity vector. CLI verb: `set-physics-gravity`. " +
    "3D default `[0, -9.81, 0]`. 2D default `[0, -9.81]` (pass `--2d`). " +
    "Persists to DynamicsManager.asset / Physics2DSettings.asset.",
  requirements: null,
  args: {
    value: {
      type: 'array',
      required: true,
      cli: '--value',
      description: 'JSON array. 3D: `[x,y,z]`. 2D: `[x,y]`.',
    },
    twoD: { type: 'boolean', cli: '--2d', description: 'Apply to Physics2D.gravity instead of Physics.gravity.' },
  },
  result: {
    type: 'object',
    fields: {
      twoD: { type: 'boolean' },
      gravity: { type: 'array' },
    },
  },
  examples: [
    {
      title: 'Lighter gravity for a moon level (3D)',
      cli: "./bin/dreamer set-physics-gravity --value '[0,-1.62,0]' --wait",
      args: { value: [0, -1.62, 0] },
    },
    {
      title: '2D zero gravity',
      cli: "./bin/dreamer set-physics-gravity --value '[0,0]' --2d --wait",
      args: { value: [0, 0], twoD: true },
    },
  ],
};
