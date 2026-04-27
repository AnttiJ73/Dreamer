'use strict';

module.exports = {
  kind: 'set_default_icon',
  summary:
    "Set the project's Default Icon (Player Settings → Icon → Default Icon). CLI verb: `set-default-icon`. " +
    "Unity uses this icon for any platform that doesn't have a per-platform icon override. " +
    "One Texture2D — Unity scales it as needed. For per-platform icon arrays, use set-app-icons.",
  requirements: null,
  args: {
    texture: {
      type: 'string',
      required: true,
      cli: '--texture',
      description: 'Asset path to a Texture2D. The asset\'s TextureImporter type should be `Default` (not `Sprite`); Read/Write doesn\'t need to be enabled.',
    },
  },
  result: { type: 'object', fields: { texture: { type: 'string' }, target: { type: 'string' }, set: { type: 'boolean' } } },
  examples: [
    {
      title: 'Use Logo.png as the default app icon',
      cli: './bin/dreamer set-default-icon --texture Assets/Icons/Logo.png --wait',
      args: { texture: 'Assets/Icons/Logo.png' },
    },
  ],
  pitfalls: [
    'If the texture is imported as Sprite, LoadAssetAtPath<Texture2D> returns null. Re-import as Default texture type or change in TextureImporter.',
  ],
};
