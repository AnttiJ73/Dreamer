'use strict';

module.exports = {
  kind: 'delete_sprite_curve',
  summary:
    "Remove a sprite-swap (object-reference) curve from an AnimationClip. CLI verb: `delete-sprite-curve`. " +
    "Identifies the binding by (target, componentType, propertyName); same defaults as set-sprite-curve " +
    "(SpriteRenderer.m_Sprite if unset).",
  requirements: null,
  args: {
    assetPath: { type: 'string', cli: '--asset' },
    guid: { type: 'string', cli: '--asset (GUID form)' },
    target: { type: 'string', cli: '--target' },
    componentType: { type: 'string', cli: '--component', description: 'Default UnityEngine.SpriteRenderer.' },
    propertyName: { type: 'string', cli: '--property', description: 'Default m_Sprite.' },
  },
  constraints: [
    { rule: 'atLeastOne', fields: ['assetPath', 'guid'] },
  ],
  result: {
    type: 'object',
    fields: {
      deleted: { type: 'boolean' },
      assetPath: { type: 'string' },
      target: { type: 'string' },
      componentType: { type: 'string' },
      propertyName: { type: 'string' },
    },
  },
  examples: [
    {
      title: 'Drop the walk-cycle sprite curve',
      cli: './bin/dreamer delete-sprite-curve --asset Assets/Animations/Walk.anim --target Visuals --wait',
      args: { assetPath: 'Assets/Animations/Walk.anim', target: 'Visuals' },
    },
  ],
};
