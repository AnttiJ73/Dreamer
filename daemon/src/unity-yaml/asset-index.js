'use strict';

// Project-wide asset index built by scanning .meta files. Every Unity asset
// (Assets/, Packages/) has a sibling .meta with a GUID; the index maps:
//   guid → { path, ext, importerType, mtime }
//   path → guid
//
// Cached in memory for the lifetime of the CLI process. Re-scans when the
// Assets/Packages roots' newest mtime is younger than the cache. Cheap
// because we walk directories, not file contents (just stat the .meta).
//
// .meta files use a small subset of YAML: fileFormatVersion, guid, and ONE
// importer block (e.g. `PrefabImporter:`, `NativeFormatImporter:`,
// `TextureImporter:`, `MonoImporter:`, etc.). The importer's name is the
// asset's "importer type" — we record it because the type filter on
// `find_assets` (e.g. `--type prefab`) lookups happen via importer.

const fs = require('fs');
const path = require('path');

// Two scopes:
//   • 'project' — Assets/ + Packages/ (the manifest-pinned surface a user
//     authors and ships). This is what find_assets / inspect_asset etc.
//     should consider.
//   • 'cache'   — Library/PackageCache/ (resolved package contents Unity
//     ships with — CanvasScaler.cs, GraphicRaycaster.cs, etc. live there).
//     Loaded lazily on first script-resolver miss, NOT included in
//     find_assets results.
const PROJECT_ROOTS = ['Assets', 'Packages'];
const CACHE_ROOTS = ['Library/PackageCache'];

let cached = null;

function projectRoot() {
  return path.resolve(__dirname, '..', '..', '..');
}

// Map of importer-class → simplified type name used by find_assets.
// (Mirrors the strings AssetDatabase.GetMainAssetTypeAtPath returns for the
// most common asset categories.)
const IMPORTER_TO_TYPE = {
  PrefabImporter:           'GameObject',
  NativeFormatImporter:     null,    // .mat, .anim, .controller, .asset — disambiguated by ext
  DefaultImporter:          null,    // disambiguate by ext
  TextureImporter:          'Texture2D',
  TextScriptImporter:       'TextAsset',
  MonoImporter:             'MonoScript',
  ModelImporter:            'Model',
  ShaderImporter:           'Shader',
  ComputeShaderImporter:    'ComputeShader',
  AudioImporter:            'AudioClip',
  TrueTypeFontImporter:     'Font',
  AssemblyDefinitionImporter:        'AssemblyDefinitionAsset',
  AssemblyDefinitionReferenceImporter: 'AssemblyDefinitionReferenceAsset',
  PackageManifestImporter:  'TextAsset',
  SpeedTreeImporter:        'Model',
  IHVImageFormatImporter:   'Texture2D',
  PluginImporter:           'PluginImporter',
  VideoClipImporter:        'VideoClip',
};

// Extension → type fallback when importer is generic (NativeFormatImporter etc.)
const EXT_TO_TYPE = {
  '.prefab':              'GameObject',
  '.mat':                 'Material',
  '.anim':                'AnimationClip',
  '.controller':          'AnimatorController',
  '.overrideController':  'AnimatorOverrideController',
  '.mask':                'AvatarMask',
  '.unity':               'SceneAsset',
  '.asset':               'ScriptableObject',
  '.preset':              'Preset',
  '.physicMaterial':      'PhysicMaterial',
  '.physicsMaterial2D':   'PhysicsMaterial2D',
  '.shader':              'Shader',
  '.shadergraph':         'Shader',
  '.shadersubgraph':      'Shader',
  '.compute':             'ComputeShader',
  '.cs':                  'MonoScript',
  '.dll':                 'Object',
  '.png':                 'Texture2D',
  '.jpg':                 'Texture2D',
  '.jpeg':                'Texture2D',
  '.tga':                 'Texture2D',
  '.psd':                 'Texture2D',
  '.tif':                 'Texture2D',
  '.tiff':                'Texture2D',
  '.bmp':                 'Texture2D',
  '.exr':                 'Texture2D',
  '.gif':                 'Texture2D',
  '.iff':                 'Texture2D',
  '.pict':                'Texture2D',
  '.hdr':                 'Texture2D',
  '.fbx':                 'Model',
  '.obj':                 'Model',
  '.dae':                 'Model',
  '.3ds':                 'Model',
  '.dxf':                 'Model',
  '.blend':               'Model',
  '.mp3':                 'AudioClip',
  '.wav':                 'AudioClip',
  '.ogg':                 'AudioClip',
  '.aif':                 'AudioClip',
  '.aiff':                'AudioClip',
  '.flac':                'AudioClip',
  '.mod':                 'AudioClip',
  '.it':                  'AudioClip',
  '.s3m':                 'AudioClip',
  '.xm':                  'AudioClip',
  '.ttf':                 'Font',
  '.otf':                 'Font',
  '.txt':                 'TextAsset',
  '.json':                'TextAsset',
  '.xml':                 'TextAsset',
  '.yaml':                'TextAsset',
  '.yml':                 'TextAsset',
  '.md':                  'TextAsset',
  '.html':                'TextAsset',
  '.htm':                 'TextAsset',
  '.csv':                 'TextAsset',
  '.bytes':               'TextAsset',
  '.asmdef':              'AssemblyDefinitionAsset',
  '.asmref':              'AssemblyDefinitionReferenceAsset',
  '.uxml':                'VisualTreeAsset',
  '.uss':                 'StyleSheet',
  '.spriteatlas':         'SpriteAtlas',
  '.spriteatlasv2':       'SpriteAtlas',
  '.cubemap':             'Cubemap',
  '.flare':               'Flare',
  '.guiskin':             'GUISkin',
  '.lighting':            'LightingDataAsset',
  '.fontsettings':        'Font',
  '.mp4':                 'VideoClip',
  '.mov':                 'VideoClip',
  '.webm':                'VideoClip',
};

/** Build (or return cached) project asset index. */
function loadIndex(opts = {}) {
  const root = projectRoot();
  if (cached && !opts.force) {
    if (opts.includeCache && !cached.cacheLoaded) extendWithCache(cached);
    return cached;
  }

  const byGuid = new Map();
  const byPath = new Map();
  const byType = new Map();

  for (const r of PROJECT_ROOTS) {
    walkMeta(path.join(root, r), root, (entry) => {
      entry.scope = 'project';
      byGuid.set(entry.guid, entry);
      byPath.set(entry.path, entry);
      const t = entry.type;
      if (!byType.has(t)) byType.set(t, []);
      byType.get(t).push(entry);
    });
  }

  cached = {
    root,
    byGuid,
    byPath,
    byType,
    builtAt: Date.now(),
    count: byGuid.size,
    cacheLoaded: false,
  };
  if (opts.includeCache) extendWithCache(cached);
  return cached;
}

function extendWithCache(idx) {
  for (const r of CACHE_ROOTS) {
    walkMeta(path.join(idx.root, r), idx.root, (entry) => {
      if (idx.byGuid.has(entry.guid)) return;
      entry.scope = 'cache';
      idx.byGuid.set(entry.guid, entry);
      idx.byPath.set(entry.path, entry);
      const t = entry.type;
      if (!idx.byType.has(t)) idx.byType.set(t, []);
      idx.byType.get(t).push(entry);
    });
  }
  idx.cacheLoaded = true;
  idx.count = idx.byGuid.size;
}

function walkMeta(dir, root, visit) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return; }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    // Unity excludes "documentation only" folders (suffix `~`) — Samples~,
    // Tests~, Documentation~, etc. — from the AssetDatabase. Mirror that.
    if (e.name.endsWith('~')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      walkMeta(full, root, visit);
    } else if (e.name.endsWith('.meta')) {
      const assetFull = full.slice(0, -5);
      // Folders also have .meta files (DefaultImporter). Unity-side find_assets
      // doesn't return folders, so skip them here too.
      let assetStat;
      try { assetStat = fs.statSync(assetFull); } catch { continue; }
      if (assetStat.isDirectory()) continue;
      const physicalRel = path.relative(root, assetFull).replace(/\\/g, '/');
      // Rewrite PackageCache paths to their logical Packages/<name>/ form.
      // Unity reports file paths as `Packages/com.foo/...` even though the
      // bytes live at `Library/PackageCache/com.foo@<hash>/...`.
      let assetRel = physicalRel;
      const m = /^Library\/PackageCache\/([^@/]+)@[^/]+\/(.+)$/.exec(assetRel);
      if (m) assetRel = `Packages/${m[1]}/${m[2]}`;
      const ext = path.extname(assetRel).toLowerCase();
      let metaStat;
      try { metaStat = fs.statSync(full); } catch { continue; }
      const meta = readMetaQuick(full);
      if (!meta || !meta.guid) continue;
      const importerType = meta.importerType;
      const type = resolveType(importerType, ext);
      visit({
        guid: meta.guid,
        path: assetRel,
        physicalPath: physicalRel,
        ext,
        importerType,
        type,
        mtime: metaStat.mtimeMs,
        assetMtime: assetStat.mtimeMs,
      });
    }
  }
}

// Read the first ~30 lines of a .meta file looking for `guid:` and the
// importer block name. Avoids parsing the full YAML for every file.
function readMetaQuick(metaPath) {
  let text;
  try { text = fs.readFileSync(metaPath, 'utf8'); }
  catch { return null; }
  const lines = text.split(/\r\n|\r|\n/);
  let guid = null;
  let importerType = null;
  for (let i = 0; i < lines.length && i < 60; i++) {
    const ln = lines[i];
    if (!guid) {
      const gm = /^guid:\s*([0-9a-fA-F]{32})\s*$/.exec(ln);
      if (gm) { guid = gm[1].toLowerCase(); continue; }
    }
    if (!importerType) {
      const im = /^([A-Za-z][A-Za-z0-9_]*Importer):\s*$/.exec(ln);
      if (im) importerType = im[1];
    }
    if (guid && importerType) break;
  }
  if (!guid) return null;
  return { guid, importerType };
}

function resolveType(importerType, ext) {
  if (importerType && IMPORTER_TO_TYPE[importerType]) return IMPORTER_TO_TYPE[importerType];
  if (EXT_TO_TYPE[ext]) return EXT_TO_TYPE[ext];
  return 'Object';
}

function pathToGuid(p) {
  return loadIndex().byPath.get(p)?.guid || null;
}
function guidToPath(g) {
  return loadIndex().byGuid.get(g.toLowerCase())?.path || null;
}
function entryByPath(p) {
  return loadIndex().byPath.get(p) || null;
}
function entryByGuid(g) {
  return loadIndex().byGuid.get(g.toLowerCase()) || null;
}

module.exports = {
  loadIndex,
  pathToGuid,
  guidToPath,
  entryByPath,
  entryByGuid,
  IMPORTER_TO_TYPE,
  EXT_TO_TYPE,
};
