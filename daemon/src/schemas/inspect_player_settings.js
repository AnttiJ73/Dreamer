'use strict';

module.exports = {
  kind: 'inspect_player_settings',
  summary:
    "PlayerSettings overview via the static UnityEditor.PlayerSettings API. CLI verb: `inspect-player-settings`. " +
    "Returns common fields (companyName, productName, bundleVersion, screen size, color space, cursor texture, " +
    "default icons), plus per-platform fields (applicationIdentifier, scriptingBackend, apiCompatibilityLevel, " +
    "platform icons) for the requested target. Default target is `standalone`.",
  requirements: null,
  args: {
    target: {
      type: 'string',
      cli: '--target',
      enum: ['default', 'standalone', 'android', 'ios', 'webgl', 'tvos', 'windowsstore', 'ps4', 'ps5', 'xboxone', 'switch'],
      description: 'Build target to read per-platform fields from. Default `standalone`. Use `default` for the icon/identity slots that apply when no platform override exists.',
    },
  },
  result: {
    type: 'object',
    fields: {
      companyName: { type: 'string' },
      productName: { type: 'string' },
      bundleVersion: { type: 'string' },
      targetPlatform: { type: 'string' },
      applicationIdentifier: { type: 'string', description: 'Per-platform bundle id (e.g. com.example.app).' },
      defaultScreenWidth: { type: 'integer' },
      defaultScreenHeight: { type: 'integer' },
      fullScreenMode: { type: 'string' },
      resizableWindow: { type: 'boolean' },
      runInBackground: { type: 'boolean' },
      colorSpace: { type: 'string' },
      scriptingBackend: { type: 'string', description: 'Mono / IL2CPP for the inspected platform.' },
      apiCompatibilityLevel: { type: 'string' },
      cursorTexture: { type: 'string', description: 'Asset path of the default cursor texture, or empty if unset.' },
      cursorHotspot: { type: 'array' },
      defaultIcons: { type: 'array', description: 'Asset paths of textures in the Default Icon slot (NamedBuildTarget.Unknown).' },
      platformIcons: { type: 'object', description: 'Asset paths of platform icons for the inspected target.' },
    },
  },
  examples: [
    { title: 'Standalone overview', cli: './bin/dreamer inspect-player-settings', args: {} },
    { title: 'Android-specific', cli: './bin/dreamer inspect-player-settings --target android', args: { target: 'android' } },
  ],
};
