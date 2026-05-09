'use strict';

// Node-side find_assets — parity with AssetOps.FindAssets in the Unity bridge.
// Output shape matches exactly so downstream code is unaffected.
//
// Limitations vs Unity-side:
//   • Type filter is matched against the index's resolved type name (importer
//     class → simplified type, or extension fallback). Unity's
//     AssetDatabase.GetMainAssetTypeAtPath uses runtime type resolution which
//     can differ for sub-imported assets (e.g. a sliced sprite sheet's
//     individual sprites). For top-level main assets they agree.
//   • Doesn't inspect asset CONTENT (so e.g. doesn't expose "isReadable" of
//     a texture) — only what's derivable from .meta + filename.

const fs = require('fs');
const path = require('path');
const { loadIndex } = require('./asset-index');

// Same upper bound as the Unity-side handler.
const MAX_RESULTS = 1000;

// Caller-friendly type aliases (case-insensitive). Mirrors Unity's
// `AssetDatabase.FindAssets("t:prefab")` etc.
const TYPE_ALIASES = {
  prefab: 'GameObject',
  gameobject: 'GameObject',
  scene: 'SceneAsset',
  sceneasset: 'SceneAsset',
  material: 'Material',
  texture: 'Texture2D',
  texture2d: 'Texture2D',
  sprite: 'Texture2D',
  shader: 'Shader',
  computeshader: 'ComputeShader',
  mesh: 'Mesh',
  model: 'Model',
  animation: 'AnimationClip',
  animationclip: 'AnimationClip',
  animator: 'AnimatorController',
  animatorcontroller: 'AnimatorController',
  override: 'AnimatorOverrideController',
  avatarmask: 'AvatarMask',
  audio: 'AudioClip',
  audioclip: 'AudioClip',
  font: 'Font',
  text: 'TextAsset',
  textasset: 'TextAsset',
  script: 'MonoScript',
  monoscript: 'MonoScript',
  scriptable: 'ScriptableObject',
  scriptableobject: 'ScriptableObject',
  asmdef: 'AssemblyDefinitionAsset',
  preset: 'Preset',
  video: 'VideoClip',
  videoclip: 'VideoClip',
  spriteatlas: 'SpriteAtlas',
  cubemap: 'Cubemap',
  flare: 'Flare',
  guiskin: 'GUISkin',
  lighting: 'LightingDataAsset',
  uxml: 'VisualTreeAsset',
  uss: 'StyleSheet',
};

function findAssets(args = {}) {
  const typeFilter = args.type ? String(args.type) : 'all';
  const nameFilter = args.name ? String(args.name) : null;
  const pathFilter = args.path ? String(args.path).replace(/\\/g, '/').replace(/\/$/, '') : null;

  // Unity's AssetDatabase.FindAssets searches Assets/ + Packages/ + PackageCache,
  // so we load all three to match. Cost: ~1-2s on first call per CLI process,
  // cached after. Pass `--project-only` (or `args.projectOnly`) to skip cache
  // for tighter project-scoped results.
  const idx = args.projectOnly ? loadIndex() : loadIndex({ includeCache: true });

  // Folder filter validation — Unity-side returns "Folder not found" if the
  // caller passes a path that isn't a folder. We approximate by checking
  // the directory exists on disk.
  if (pathFilter) {
    const full = path.join(idx.root, pathFilter);
    if (!fs.existsSync(full) || !fs.statSync(full).isDirectory()) {
      return { error: `Folder not found: ${pathFilter}` };
    }
  }

  const wantType = resolveTypeFilter(typeFilter);

  const matches = [];
  let totalFound = 0;
  for (const entry of idx.byPath.values()) {
    // `--project-only` skips PackageCache. Default matches Unity's FindAssets.
    if (args.projectOnly && entry.scope === 'cache') continue;
    if (wantType !== null && entry.type !== wantType) continue;
    if (pathFilter && !entry.path.startsWith(pathFilter + '/') && entry.path !== pathFilter) continue;
    if (nameFilter) {
      const fileName = path.basename(entry.path, entry.ext);
      const lowered = nameFilter.toLowerCase();
      if (!fileName.toLowerCase().includes(lowered) && !entry.path.toLowerCase().includes(lowered)) continue;
    }
    totalFound++;
    if (matches.length < MAX_RESULTS) {
      matches.push({
        name: path.basename(entry.path, entry.ext),
        path: entry.path,
        guid: entry.guid,
        type: entry.type,
        lastModified: new Date(entry.mtime).toISOString(),
      });
    }
  }

  return {
    assets: matches,
    count: matches.length,
    totalFound,
  };
}

function resolveTypeFilter(t) {
  if (!t || t === 'all') return null;
  const lc = String(t).toLowerCase();
  if (TYPE_ALIASES[lc]) return TYPE_ALIASES[lc];
  // Pass through canonical Unity type names verbatim.
  return t;
}

module.exports = { findAssets };
