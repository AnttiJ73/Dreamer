'use strict';

module.exports = {
  kind: 'screenshot_prefab',
  summary:
    "Render a prefab to a PNG file so the agent can see it. CLI verb: `screenshot-prefab`. " +
    "Uses Unity's PreviewRenderUtility (the same machinery the inspector uses for asset thumbnails) " +
    "to render the prefab off-screen against a neutral gray background with two-light rim lighting. " +
    "Camera is auto-framed on the prefab's combined renderer bounds. " +
    "Returns the file path; open it with the Read tool to view (Claude Code is multimodal — Read returns the image inline). " +
    "Files are written under `Library/DreamerScreenshots/` by default (gitignored).",
  requirements: null,
  args: {
    assetPath: { type: 'string', cli: '--asset', description: 'Path to a `.prefab` asset.' },
    guid: { type: 'string', cli: '--asset (GUID form)', description: 'Alternative to assetPath: 32-char Unity GUID.' },
    width: { type: 'integer', cli: '--width', description: 'Render width in pixels. Default 512. Max 4096. Larger costs more tokens when read.' },
    height: { type: 'integer', cli: '--height', description: 'Render height. Default 512. Max 4096.' },
    angle: {
      type: 'string',
      cli: '--angle',
      enum: ['iso', 'front', 'back', 'side', 'right', 'left', 'top', 'bottom'],
      description: 'Camera angle preset. Default `iso` (3/4 view). Use `front`/`side`/`top` for orthographic-style framing.',
    },
    savePath: {
      type: 'string',
      cli: '--save-to',
      description: 'Optional output path. Default `DreamerScreenshots/<stem>-<guid8>-<ts>.png` at the project root. The folder is auto-created with a self-ignoring `.gitignore` so PNGs stay out of source control while remaining visible in VS Code\'s Explorer.',
    },
    backgroundColor: {
      type: 'any',
      cli: '--background-color',
      description: 'Background fill. Hex string (`#RRGGBB` or `#RRGGBBAA`) or JSON array of 0..1 floats (`[0.2,0.2,0.2]` or `[r,g,b,a]`). Default neutral gray.',
    },
    transparent: {
      type: 'boolean',
      cli: '--transparent',
      description: 'Render with a transparent background (alpha=0). Overrides `backgroundColor`. Output PNG preserves alpha.',
    },
    size: {
      type: 'array',
      cli: '--size',
      description:
        'UI-only. Override the prefab\'s RectTransform sizeDelta as `[width,height]`. ' +
        'Useful for fragments designed to be sized by a parent layout group at runtime — without this, ' +
        'they render at their authored (often zero or tiny) size. ' +
        'When unset: LayoutElement.preferredWidth/Height hints are used; falls back to 400×100.',
    },
  },
  constraints: [
    { rule: 'atLeastOne', fields: ['assetPath', 'guid'] },
  ],
  result: {
    type: 'object',
    fields: {
      asset: { type: 'string' },
      path: { type: 'string', description: 'Filesystem path to the PNG. Read it with the Read tool to view.' },
      width: { type: 'integer' },
      height: { type: 'integer' },
      byteCount: { type: 'integer' },
      angle: { type: 'string' },
      boundsCenter: { type: 'array', description: 'World-space center of the prefab\'s combined renderer bounds (after instantiation).' },
      boundsSize: { type: 'array' },
      hint: { type: 'string' },
    },
  },
  examples: [
    {
      title: 'Default 512×512 isometric thumbnail',
      cli: './bin/dreamer screenshot-prefab --asset Assets/Prefabs/Player.prefab --wait',
      args: { assetPath: 'Assets/Prefabs/Player.prefab' },
    },
    {
      title: 'High-res front view for a UI menu prefab',
      cli: './bin/dreamer screenshot-prefab --asset Assets/Prefabs/MainMenu.prefab --angle front --width 1024 --height 768 --wait',
      args: { assetPath: 'Assets/Prefabs/MainMenu.prefab', angle: 'front', width: 1024, height: 768 },
    },
    {
      title: 'List-item fragment with explicit size',
      cli: "./bin/dreamer screenshot-prefab --asset Assets/Prefabs/UI/RowItem.prefab --size '[400,80]' --wait",
      args: { assetPath: 'Assets/Prefabs/UI/RowItem.prefab', size: [400, 80] },
    },
  ],
  pitfalls: [
    'UI/Canvas prefabs render via a separate code path (auto-detected when the prefab has a Canvas at root, a Canvas descendant, OR is a fragment with uGUI components but no Canvas). Result includes `mode: "ui"`, camera switches to orthographic, default angle becomes `front`. Standard uGUI (Image, Text, Button, Slider, Toggle, Dropdown, Panel) renders correctly.',
    'Fragment prefabs (no Canvas — list items, button rows, slot prefabs etc) are wrapped in a temporary WorldSpace Canvas. Their RectTransform is sized from `LayoutElement.preferredWidth/Height` if present, else 400×100. Override with `--size [w,h]` for prefabs whose authored size is wrong (zero-sized layout-driven prefabs are common).',
    '**TextMeshProUGUI (TMP) text often comes back invisible** — TMP has its own mesh-build pipeline that doesn\'t tick from `Canvas.ForceUpdateCanvases`. Standard `UnityEngine.UI.Text` works.',
    'Prefabs with no MeshRenderer/SkinnedMeshRenderer/SpriteRenderer/Canvas (logic-only prefabs, scripts + Rigidbody, etc.) render an empty scene. The result\'s `boundsSize` will be `[1,1,1]` (the fallback) — that\'s the signal.',
    'Larger images consume more multimodal tokens when read. Default 512 is a good balance; go smaller (256) for batch overviews, larger (1024+) when you need detail.',
    'On Windows, Unity must have focus or the render may come back black on some GPU/driver combos. If you get an all-black PNG, run `dreamer focus-unity` first.',
    'Particle systems, trail/line renderers, lights, and post-processing effects don\'t contribute to bounds (they render dynamically) — the camera frames the static-mesh extent only.',
  ],
};
