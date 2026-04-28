'use strict';

module.exports = {
  kind: 'screenshot_scene',
  summary:
    "Render any Camera in the active scene to a PNG file. CLI verb: `screenshot-scene`. " +
    "Defaults to `Camera.main`; pass `--camera NAME` (or scene path) to render a different one. " +
    "Captures the camera's full view including 3D geometry, 2D sprites, particles, post-processing, " +
    "and UI canvases. ScreenSpaceOverlay canvases are temporarily flipped to ScreenSpaceCamera " +
    "with the render camera so they get drawn into the offscreen RT, then restored. " +
    "Output to `DreamerScreenshots/scene-<camName>-<ticks>.png` at project root by default. The folder is auto-created with a self-ignoring `.gitignore` so PNGs stay out of source control but remain visible in VS Code.",
  requirements: null,
  args: {
    camera: {
      type: 'string',
      cli: '--camera',
      description: 'Camera by name (`Main Camera`) or scene path (`/Cameras/SpectatorCam`). When unset: uses `Camera.main`, falling back to the first Camera in the active scene.',
    },
    preset: {
      type: 'string',
      cli: '--preset',
      enum: ['layout', 'normal', 'text'],
      description:
        'Resolution preset. **layout** = 800×450 (quick composition check, small file), ' +
        '**normal** = 1280×720 (balanced — same as default), ' +
        '**text** = 2560×1440 (text readability, dense detail). ' +
        'Explicit --width/--height override the preset for either dimension.',
    },
    width: { type: 'integer', cli: '--width', description: 'Render width in pixels. Default 1280 (or `preset` value). Max 4096.' },
    height: { type: 'integer', cli: '--height', description: 'Render height. Default 720 (or `preset` value). Max 4096.' },
    filterMode: {
      type: 'string',
      cli: '--filter-mode',
      enum: ['point', 'bilinear', 'trilinear'],
      description:
        'Override the filter mode of every UI source texture (Image, RawImage, SpriteRenderer) for the duration of the render, then restore. ' +
        '**Default: point** — sharper than Unity\'s authored filter modes (almost always Bilinear) and the right call for agent inspection. ' +
        'Pass `bilinear` / `trilinear` to override (rarely needed; bilinear can look slightly smoother for downscaled / non-integer-scaled / rotated UI but the difference is minor in screenshots). ' +
        'Render targets also inherit this filter and MSAA is disabled (antiAliasing=1) so output is pixel-accurate.',
    },
    backgroundColor: {
      type: 'any',
      cli: '--background-color',
      description: 'Override clear color. Hex (`#RRGGBB[AA]`) or JSON `[r,g,b,a]`. By default the camera\'s own clear color is overridden to opaque black; pass this to use a different fill.',
    },
    transparent: {
      type: 'boolean',
      cli: '--transparent',
      description: 'Render with a transparent background (alpha=0). Only meaningful for cameras whose clear flags are SolidColor — Skybox cameras still render the skybox. Output PNG is RGBA.',
    },
    savePath: {
      type: 'string',
      cli: '--save-to',
      description: 'Output path. Default `DreamerScreenshots/scene-<camName>-<ticks>.png` at project root.',
    },
  },
  result: {
    type: 'object',
    fields: {
      camera: { type: 'string' },
      path: { type: 'string', description: 'Filesystem path to the PNG. Read it with the Read tool to view.' },
      width: { type: 'integer' },
      height: { type: 'integer' },
      byteCount: { type: 'integer' },
      flippedOverlayCanvases: { type: 'integer', description: 'How many ScreenSpaceOverlay canvases were temporarily flipped to ScreenSpaceCamera for the render.' },
      hint: { type: 'string' },
    },
  },
  examples: [
    {
      title: 'Default 720p screenshot of the main camera',
      cli: './bin/dreamer screenshot-scene --wait',
      args: {},
    },
    {
      title: 'Quick layout check at 800×450',
      cli: './bin/dreamer screenshot-scene --preset layout --wait',
      args: { preset: 'layout' },
    },
    {
      title: '1440p sharp render for text readability (point filter is the default)',
      cli: './bin/dreamer screenshot-scene --preset text --wait',
      args: { preset: 'text' },
    },
    {
      title: '4K screenshot of a specific camera',
      cli: './bin/dreamer screenshot-scene --camera "SpectatorCam" --width 3840 --height 2160 --wait',
      args: { camera: 'SpectatorCam', width: 3840, height: 2160 },
    },
    {
      title: 'Square thumbnail with transparent background',
      cli: './bin/dreamer screenshot-scene --width 512 --height 512 --transparent --wait',
      args: { width: 512, height: 512, transparent: true },
    },
  ],
  pitfalls: [
    'PNGs invisible in VS Code Explorer? Unity\'s auto-generated `.vscode/settings.json` hides `**/*.png` (and other image extensions) globally. Scope the exclusion to `Assets/**/*.png` etc. to keep imported-texture clutter hidden while making screenshots visible.',
    'Cameras with `clearFlags: Skybox` still render the skybox even when --transparent is passed. To get a transparent render, the camera must use `SolidColor` clear flags (Dreamer overrides backgroundColor but not clearFlags by design — clearFlags affects what the camera composites against the rest of the scene).',
    'Post-processing volumes that depend on screen dimensions may produce slightly different results than the editor Game view if --width/--height differ from the Game view aspect ratio.',
    'TextMeshPro text in ScreenSpaceOverlay canvases sometimes comes back partially built — TMP\'s mesh-build pipeline expects a runtime tick. Try rendering twice, or set the canvas to ScreenSpaceCamera in the project for stable previews.',
    'Multiple cameras with overlapping render orders: only the specified --camera renders. To compose multiple cameras (main + UI overlay etc.), render each separately and composite outside Unity.',
  ],
};
