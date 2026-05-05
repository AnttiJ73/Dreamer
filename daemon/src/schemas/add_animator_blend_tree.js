'use strict';

module.exports = {
  kind: 'add_animator_blend_tree',
  summary:
    "Add a state whose Motion is a BlendTree. CLI verb: `add-animator-blend-tree`. " +
    "Blend trees smoothly interpolate between AnimationClips driven by parameters (1D for speed-driven walk/run, 2D for omnidirectional movement, Direct for additive layering).",
  requirements: null,
  args: {
    assetPath: { type: 'string', cli: '--asset' },
    guid:      { type: 'string', cli: '--asset (GUID form)' },
    layer:     { type: 'integer', cli: '--layer', description: 'Layer index. Default 0.' },
    name:      { type: 'string', cli: '--name', description: 'State name that will hold the blend tree.' },
    type:      {
      type: 'string',
      cli: '--type',
      enum: ['1d', '2d-simple', '2d-freeform-directional', '2d-freeform-cartesian', 'direct'],
      description: '`1d`=Simple1D (one parameter, scalar threshold). `2d-simple`=SimpleDirectional2D (only one motion per direction). `2d-freeform-directional`=FreeformDirectional2D (multiple motions per direction). `2d-freeform-cartesian`=FreeformCartesian2D (arbitrary positions). `direct`=Direct (one weight parameter per child).',
    },
    blendParameter:  { type: 'string', cli: '--blend-parameter', description: 'Parameter name driving blend (1D + Direct + X-axis of 2D).' },
    blendParameterY: { type: 'string', cli: '--blend-parameter-y', description: 'Y-axis parameter (2D variants only).' },
    children: {
      type: 'array',
      cli: '--children',
      description:
        'JSON array of child entries. Per type:\n' +
        '  1D: `{"motion":"path/Idle.anim","threshold":0,"timeScale":1,"mirror":false,"cycleOffset":0}`\n' +
        '  2D: `{"motion":"path/Forward.anim","position":[0,1]}`\n' +
        '  Direct: `{"motion":"path/Idle.anim","directBlendParameter":"idleWeight"}`',
    },
  },
  constraints: [{ rule: 'atLeastOne', fields: ['assetPath', 'guid'] }],
  result: {
    type: 'object',
    fields: {
      added: { type: 'boolean' },
      assetPath: { type: 'string' },
      layer: { type: 'integer' },
      name: { type: 'string' },
      type: { type: 'string' },
      blendParameter: { type: 'string' },
      blendParameterY: { type: 'string' },
      childCount: { type: 'integer' },
      isDefault: { type: 'boolean' },
    },
  },
  examples: [
    {
      title: '1D blend: Idle → Walk → Run on speed parameter',
      cli: './bin/dreamer add-animator-blend-tree --asset Assets/Animators/PlayerCtl.controller --name Move --type 1d --blend-parameter speed --children \'[{"motion":"Assets/Animations/Idle.anim","threshold":0},{"motion":"Assets/Animations/Walk.anim","threshold":3},{"motion":"Assets/Animations/Run.anim","threshold":7}]\' --wait',
      args: { assetPath: 'Assets/Animators/PlayerCtl.controller', name: 'Move', type: '1d', blendParameter: 'speed', children: [{ motion: 'Assets/Animations/Idle.anim', threshold: 0 }, { motion: 'Assets/Animations/Walk.anim', threshold: 3 }, { motion: 'Assets/Animations/Run.anim', threshold: 7 }] },
    },
    {
      title: '2D directional movement (omnidirectional walk on x/y)',
      cli: './bin/dreamer add-animator-blend-tree --asset Assets/Animators/PlayerCtl.controller --name MoveBlend --type 2d-simple --blend-parameter moveX --blend-parameter-y moveY --children \'[{"motion":"Assets/Animations/Idle.anim","position":[0,0]},{"motion":"Assets/Animations/Forward.anim","position":[0,1]},{"motion":"Assets/Animations/Backward.anim","position":[0,-1]},{"motion":"Assets/Animations/Left.anim","position":[-1,0]},{"motion":"Assets/Animations/Right.anim","position":[1,0]}]\' --wait',
      args: { assetPath: 'Assets/Animators/PlayerCtl.controller', name: 'MoveBlend', type: '2d-simple', blendParameter: 'moveX', blendParameterY: 'moveY', children: [{ motion: 'Assets/Animations/Idle.anim', position: [0, 0] }, { motion: 'Assets/Animations/Forward.anim', position: [0, 1] }, { motion: 'Assets/Animations/Backward.anim', position: [0, -1] }, { motion: 'Assets/Animations/Left.anim', position: [-1, 0] }, { motion: 'Assets/Animations/Right.anim', position: [1, 0] }] },
    },
  ],
  pitfalls: [
    'Add the parameters first via `add-animator-parameter` — the blend tree references them by name. Wrong/missing names produce silent runtime no-ops (children just never blend in).',
    'Children are added in one shot. To modify after creation, currently you have to remove the state and rebuild. (Future: `update-animator-blend-tree-child`.)',
    'Blend trees are stored as sub-assets of the controller — you won\'t see them as separate files in the Project view. They\'re inside the .controller file.',
  ],
};
