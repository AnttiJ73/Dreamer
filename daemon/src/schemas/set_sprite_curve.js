'use strict';

module.exports = {
  kind: 'set_sprite_curve',
  summary:
    "Write or replace a sprite-swap (object-reference) curve on an AnimationClip. " +
    "CLI verb: `set-sprite-curve`. Defaults target the SpriteRenderer's m_Sprite — " +
    "passing `--component`/`--property` lets you target Image.m_Sprite or any other " +
    "ObjectReference field. Each key has a time and a sprite reference. " +
    "Use this for sprite-sheet style 2D animation (frame swaps over time).",
  requirements: null,
  args: {
    assetPath: { type: 'string', cli: '--asset', description: 'Path to the .anim asset.' },
    guid: { type: 'string', cli: '--asset (GUID form)', description: 'AnimationClip GUID.' },
    target: { type: 'string', cli: '--target', description: 'Path inside the animated hierarchy (relative). Empty = root.' },
    componentType: { type: 'string', cli: '--component', description: 'Default `UnityEngine.SpriteRenderer`. For UI: `UnityEngine.UI.Image`.' },
    propertyName: { type: 'string', cli: '--property', description: 'Default `m_Sprite`. Rarely needs changing.' },
    keys: {
      type: 'array',
      cli: '--keys',
      description:
        'JSON array of sprite keyframes. Each: `{ "time": <seconds>, "sprite": <ref> }`. ' +
        '`sprite` accepts either a bare path string (`"Assets/Sprites/Walk.png"`) — combined with optional ' +
        'top-level `"subAsset": "Walk_0"` — or a nested object `{"assetRef":"Assets/Sprites/Sheet.png","subAsset":"Walk_0"}`. ' +
        'For multi-sprite atlases, ALWAYS pass subAsset to pick the named slice.',
    },
  },
  constraints: [
    { rule: 'atLeastOne', fields: ['assetPath', 'guid'] },
  ],
  result: {
    type: 'object',
    fields: {
      set: { type: 'boolean' },
      assetPath: { type: 'string' },
      target: { type: 'string' },
      componentType: { type: 'string' },
      propertyName: { type: 'string' },
      keyCount: { type: 'integer' },
      keys: { type: 'array', description: 'Resolved keyframes: [{time, sprite, assetPath}, ...]. The agent reads this to verify the right sprites were referenced.' },
    },
  },
  examples: [
    {
      title: 'Walk cycle: 4 sprite frames at 0.1s intervals from a multi-sprite atlas',
      cli: './bin/dreamer set-sprite-curve --asset Assets/Animations/Walk.anim --target Visuals --keys \'[{"time":0,"sprite":{"assetRef":"Assets/Sprites/Player.png","subAsset":"Walk_0"}},{"time":0.1,"sprite":{"assetRef":"Assets/Sprites/Player.png","subAsset":"Walk_1"}},{"time":0.2,"sprite":{"assetRef":"Assets/Sprites/Player.png","subAsset":"Walk_2"}},{"time":0.3,"sprite":{"assetRef":"Assets/Sprites/Player.png","subAsset":"Walk_3"}}]\' --wait',
      args: { assetPath: 'Assets/Animations/Walk.anim', target: 'Visuals', keys: [] },
    },
    {
      title: 'Single-sprite swap (e.g. blink)',
      cli: './bin/dreamer set-sprite-curve --asset Assets/Animations/Blink.anim --keys \'[{"time":0,"sprite":"Assets/Sprites/Open.png"},{"time":0.1,"sprite":"Assets/Sprites/Closed.png"},{"time":0.2,"sprite":"Assets/Sprites/Open.png"}]\' --wait',
      args: { assetPath: 'Assets/Animations/Blink.anim', keys: [] },
    },
  ],
  pitfalls: [
    'For multi-sprite atlases (Sprite Mode = Multiple), you MUST pass subAsset to pick a specific slice. Without it, the main asset (the Texture2D) gets assigned, and Unity rejects the type at runtime.',
    'For UI Image swaps, set `--component UnityEngine.UI.Image` (the default is SpriteRenderer for 2D world sprites).',
    'The duration of the clip equals the LAST keyframe time. Add a final `{"time": LAST+0.001, "sprite": same-as-last}` if you want to extend duration without a visible change.',
  ],
};
