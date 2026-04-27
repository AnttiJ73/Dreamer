'use strict';

module.exports = {
  kind: 'set_layer_collision',
  summary:
    "Set whether two layers collide in the physics layer collision matrix. CLI verb: `set-layer-collision`. " +
    "Names (`Player`) or numeric indices (`8`) are both accepted. The matrix is symmetric — setting (A,B) " +
    "automatically sets (B,A). For 2D physics pass `--2d`.",
  requirements: null,
  args: {
    layerA: { type: 'string', required: true, cli: '--layer-a', description: 'Layer name or numeric index.' },
    layerB: { type: 'string', required: true, cli: '--layer-b', description: 'Layer name or numeric index.' },
    collide: { type: 'boolean', cli: '--collide', description: 'true (default) = layers collide; false = layers ignore each other.' },
    twoD: { type: 'boolean', cli: '--2d', description: 'Apply to Physics2D matrix instead of Physics (3D).' },
  },
  result: {
    type: 'object',
    fields: {
      twoD: { type: 'boolean' },
      layerA: { type: 'integer' },
      layerAName: { type: 'string' },
      layerB: { type: 'integer' },
      layerBName: { type: 'string' },
      collide: { type: 'boolean' },
    },
  },
  examples: [
    {
      title: 'Players ignore other Players (3D)',
      cli: './bin/dreamer set-layer-collision --layer-a Player --layer-b Player --collide false --wait',
      args: { layerA: 'Player', layerB: 'Player', collide: false },
    },
    {
      title: 'Re-enable Player↔Enemy collision (2D)',
      cli: './bin/dreamer set-layer-collision --layer-a Player --layer-b Enemy --collide true --2d --wait',
      args: { layerA: 'Player', layerB: 'Enemy', collide: true, twoD: true },
    },
  ],
};
