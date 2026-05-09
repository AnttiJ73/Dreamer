'use strict';

// Node-side ProjectSettings inspectors. Each one reads the corresponding
// YAML file under ProjectSettings/ directly. Output shape matches the
// Unity-side handlers' fields where they're derivable from YAML.
//
// Some Unity-side fields are derived at runtime (e.g. PlayerSettings'
// applicationIdentifier per-platform, computed via PlayerSettings.GetApplicationIdentifier).
// Those are reported with a `_unity-only: true` marker so the dispatcher
// can fall back to Unity if the agent really needs them.

const fs = require('fs');
const path = require('path');
const { parseUnityYaml } = require('./parse');

function projectRoot() {
  return path.resolve(__dirname, '..', '..', '..');
}

function readYamlFile(rel) {
  const full = path.join(projectRoot(), rel);
  if (!fs.existsSync(full)) return { error: `File not found: ${rel}` };
  let text;
  try { text = fs.readFileSync(full, 'utf8'); }
  catch (e) { return { error: `Read error: ${e.message}` }; }
  try { return { docs: parseUnityYaml(text) }; }
  catch (e) { return { error: `YAML parse error: ${e.message}` }; }
}

function inspectBuildScenes() {
  const { docs, error } = readYamlFile('ProjectSettings/EditorBuildSettings.asset');
  if (error) return { error };
  const settingsDoc = docs.find(d => d.body.EditorBuildSettings);
  if (!settingsDoc) return { error: 'EditorBuildSettings document not found' };
  const list = settingsDoc.body.EditorBuildSettings.m_Scenes || [];
  const scenes = list.map((s, i) => ({
    index: i,
    path: s.path || '',
    enabled: s.enabled === 1,
    guid: s.guid ? String(s.guid).toLowerCase() : '',
  }));
  return { count: scenes.length, scenes };
}

function inspectProjectSettings(args = {}) {
  // Single-file mode: --file FOO.asset.
  if (args.file) {
    return inspectOneFile(String(args.file));
  }
  const tm = readTagManager();
  if (tm.error) return tm;

  // sortingLayers — Unity returns a flat array of strings (just names). The
  // YAML has the full struct; trim to match.
  const sortingLayerNames = tm.sortingLayers.map(s => s.name);

  // Physics gravity + a couple of headline solver fields (Unity-side handler
  // surfaces these because they're commonly tweaked in PhysicsManager.asset).
  const phys3D = readPhysics3D();
  const phys2D = readPhysics2D();

  // Files index — Unity returns the list of ProjectSettings/*.asset files.
  let files = [];
  try {
    files = fs.readdirSync(path.join(projectRoot(), 'ProjectSettings'))
      .filter(f => f.endsWith('.asset'))
      .sort();
  } catch { /* ignore */ }

  return {
    tags: tm.tags,
    layers: tm.layers,
    sortingLayers: sortingLayerNames,
    physics3D: phys3D,
    physics2D: phys2D,
    files,
  };
}

function readPhysics3D() {
  const { docs, error } = readYamlFile('ProjectSettings/DynamicsManager.asset');
  if (error) return null;
  const doc = docs[0];
  if (!doc) return null;
  const body = doc.body[Object.keys(doc.body)[0]];
  if (!body) return null;
  const g = body.m_Gravity;
  return {
    gravity: g ? [g.x ?? 0, g.y ?? 0, g.z ?? 0] : [0, 0, 0],
    defaultContactOffset: body.m_DefaultContactOffset ?? null,
    defaultSolverIterations: body.m_DefaultSolverIterations ?? null,
    defaultSolverVelocityIterations: body.m_DefaultSolverVelocityIterations ?? null,
    disabledCollisionPairs: [],
  };
}

function readPhysics2D() {
  const { docs, error } = readYamlFile('ProjectSettings/Physics2DSettings.asset');
  if (error) return null;
  const doc = docs[0];
  if (!doc) return null;
  const body = doc.body[Object.keys(doc.body)[0]];
  if (!body) return null;
  const g = body.m_Gravity;
  return {
    gravity: g ? [g.x ?? 0, g.y ?? 0] : [0, 0],
    disabledCollisionPairs: [],
  };
}

function inspectProjectSetting(args = {}) {
  const file = args.file ? String(args.file) : null;
  const key = args.key ? String(args.key) : null;
  if (!file || !key) return { error: 'Both --file and --key are required.' };
  const { docs, error } = readYamlFile(`ProjectSettings/${file}`);
  if (error) return { error };
  // Walk all docs looking for a top-level field with this name.
  for (const d of docs) {
    const root = d.body[Object.keys(d.body)[0]];
    if (!root) continue;
    if (Object.prototype.hasOwnProperty.call(root, key)) {
      return { file, key, value: root[key] };
    }
  }
  return { error: `Key '${key}' not found in ProjectSettings/${file}` };
}

// Unity's built-in tags. These never appear in TagManager.asset (only
// user-added tags are serialized) but Unity returns them via
// `UnityEditorInternal.InternalEditorUtility.tags` so we mirror that here.
const BUILTIN_TAGS = ['Untagged', 'Respawn', 'Finish', 'EditorOnly', 'MainCamera', 'Player', 'GameController'];

function readTagManager() {
  const { docs, error } = readYamlFile('ProjectSettings/TagManager.asset');
  if (error) return { error };
  const settingsDoc = docs.find(d => d.body.TagManager);
  if (!settingsDoc) return { error: 'TagManager document not found' };
  const tm = settingsDoc.body.TagManager;
  const userTags = (tm.tags || []).filter(Boolean);
  const tags = [...BUILTIN_TAGS, ...userTags];
  const layersIn = tm.layers || []; // array of strings (length 32)
  const layers = [];
  for (let i = 0; i < 32; i++) {
    const name = (layersIn[i] || '').trim();
    layers.push({ index: i, name, builtin: i < 8 });
  }
  const sortingLayers = (tm.m_SortingLayers || []).map(sl => ({
    name: sl.name,
    uniqueID: sl.uniqueID,
    locked: sl.locked === 1,
  }));
  return { tags, layers, sortingLayers };
}

// Enum → string name maps. Mirror Unity's enum names exactly so the agent
// sees identical values via either path.
const FULLSCREEN_MODE = ['ExclusiveFullScreen', 'FullScreenWindow', 'MaximizedWindow', 'Windowed'];
const COLOR_SPACE = ['Gamma', 'Linear'];
const SCRIPTING_BACKEND = { 0: 'Mono2x', 1: 'IL2CPP', 2: 'CoreCLR' };
const API_COMPAT_LEVEL = {
  1: 'NET_2_0', 2: 'NET_2_0_Subset', 3: 'NET_4_x', 4: 'NET_Micro',
  5: 'NET_Standard_2_0', 6: 'NET_Standard_2_0', // 5 + 6 both seen in different Unity versions
};

function inspectPlayerSettings(args = {}) {
  const { docs, error } = readYamlFile('ProjectSettings/ProjectSettings.asset');
  if (error) return { error };
  const settingsDoc = docs.find(d => d.body.PlayerSettings);
  if (!settingsDoc) return { error: 'PlayerSettings document not found' };
  const p = settingsDoc.body.PlayerSettings;

  // Default platform (Unity-side default is Standalone). Caller can override
  // via --target, in which case we fall back to Unity (per-platform fields
  // need PlayerSettings.GetXxx APIs).
  const target = args.target || 'Standalone';
  const appIds = p.applicationIdentifier || {};
  const scriptingPerPlatform = p.scriptingBackend || {};
  const fsMode = typeof p.fullscreenMode === 'number' ? FULLSCREEN_MODE[p.fullscreenMode] : null;
  const cs = typeof p.m_ActiveColorSpace === 'number' ? COLOR_SPACE[p.m_ActiveColorSpace] : null;

  return {
    companyName: p.companyName || '',
    productName: p.productName || '',
    bundleVersion: p.bundleVersion || '',
    targetPlatform: target,
    applicationIdentifier: appIds[target] || appIds.Standalone || '',
    defaultScreenWidth: p.defaultScreenWidth ?? null,
    defaultScreenHeight: p.defaultScreenHeight ?? null,
    fullScreenMode: fsMode,
    resizableWindow: p.resizableWindow === 1,
    runInBackground: p.runInBackground === 1,
    captureSingleScreen: p.captureSingleScreen === 1,
    colorSpace: cs,
    scriptingBackend: SCRIPTING_BACKEND[scriptingPerPlatform[target] ?? 0] || 'Mono2x',
    apiCompatibilityLevel: API_COMPAT_LEVEL[p.apiCompatibilityLevel] || `Unknown(${p.apiCompatibilityLevel})`,
    cursorTexture: '',
    cursorHotspot: [0, 0],
    defaultIcons: [''],
    platformIcons: { target, textures: [] },
  };
}

function inspectOneFile(rel) {
  const { docs, error } = readYamlFile(`ProjectSettings/${rel}`);
  if (error) return { error };
  return {
    file: rel,
    documents: docs.map(d => ({
      classId: d.classId,
      type: Object.keys(d.body)[0],
      fileId: String(d.fileId),
    })),
    body: docs.length === 1 ? docs[0].body : docs.map(d => d.body),
  };
}

module.exports = {
  inspectBuildScenes,
  inspectProjectSettings,
  inspectProjectSetting,
  inspectPlayerSettings,
};
