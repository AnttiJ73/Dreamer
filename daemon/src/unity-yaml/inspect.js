'use strict';

// Node-side `inspect_asset` — parity with AssetOps.InspectAsset + the
// Inspection.BuildNode walker on the Unity bridge.
//
// Output shape mirrors the Unity-side handler exactly so downstream code
// (CLI, agents, schemas) doesn't change. Two notable simplifications:
//   • `instanceId` is the YAML fileID (a stable per-asset identifier),
//     not Unity's runtime InstanceID. They look the same to a reader and
//     are equally usable for cross-reference within an inspect run.
//   • `enabled` defaults to true for component classes we don't have a
//     specific rule for. Behaviour subclasses honor `m_Enabled`. Renderers
//     honor `m_Enabled`. Colliders honor `m_Enabled`. Unknown components
//     get `enabled: true` — same default Unity uses for non-Behaviour.

const fs = require('fs');
const path = require('path');
const { parseUnityYaml } = require('./parse');
const { loadIndex, entryByPath } = require('./asset-index');
const { classIdToName } = require('./class-ids');
const { resolveScript } = require('./script-resolver');
const typed = require('./inspect-typed');

// Component class IDs whose enabled state lives in m_Enabled (1/0).
const HAS_M_ENABLED = new Set([
  // Behaviour:
  8, 95, 96, 102, 108, 110, 111, 114, 119, 120, 124, 195, 196, 197, 198, 199,
  // Renderer:
  23, 25, 199, 212, 137, 96, 120,
  // Collider:
  56, 64, 65, 66, 68, 70, 134, 135, 136, 138, 142, 153, 154,
  // Collider2D:
  53, 58, 60, 61, 62, 66, 68, 70,
  // CanvasRenderer / RectTransform / etc. don't have m_Enabled.
]);

const EXT_HANDLERS = {
  '.prefab': inspectPrefab,
  '.unity': inspectScene,
  '.mat': makeTypedHandler(typed.inspectMaterial),
  '.anim': makeTypedHandler(typed.inspectAnimationClip),
  '.controller': makeTypedHandler(typed.inspectAnimatorController),
  '.overridecontroller': makeTypedHandler(typed.inspectAnimatorOverrideController),
  '.mask': makeTypedHandler(typed.inspectAvatarMask),
  '.asset': makeScriptableObjectHandler(),
  '.shader': makeShaderHandler(),
};

// Wraps a typed inspector with the parse-and-call pipeline so each handler
// can ignore I/O concerns.
function makeTypedHandler(fn) {
  return (target, opts, idx) => {
    const fullPath = path.join(idx.root, target.physicalPath || target.path);
    let text;
    try { text = fs.readFileSync(fullPath, 'utf8'); }
    catch (e) { return { error: `Failed to read asset: ${e.message}` }; }
    let docs;
    try { docs = parseUnityYaml(text); }
    catch (e) { return { error: `YAML parse error: ${e.message}` }; }
    return fn(target, opts, idx, docs);
  };
}

function makeShaderHandler() {
  return (target, opts, idx) => {
    const fullPath = path.join(idx.root, target.physicalPath || target.path);
    let text;
    try { text = fs.readFileSync(fullPath, 'utf8'); }
    catch (e) { return { error: `Failed to read shader: ${e.message}` }; }
    return typed.inspectShader(target, opts, idx, null, text);
  };
}

function makeScriptableObjectHandler() {
  return (target, opts, idx) => {
    const fullPath = path.join(idx.root, target.physicalPath || target.path);
    let text;
    try { text = fs.readFileSync(fullPath, 'utf8'); }
    catch (e) { return { error: `Failed to read asset: ${e.message}` }; }
    let docs;
    try { docs = parseUnityYaml(text); }
    catch (e) { return { error: `YAML parse error: ${e.message}` }; }
    const r = typed.inspectScriptableObject(target, opts, idx, docs);
    if (!r) return { error: 'Asset has no recognised body (not a ScriptableObject?)' };
    return r;
  };
}

function inspectAsset(args) {
  const idx = loadIndex();
  const opts = parseInspectionOptions(args);

  const target = resolveTarget(args, idx);
  if (target.error) return target;

  const ext = path.extname(target.path).toLowerCase();
  const result = {
    path: target.path,
    guid: target.guid,
    type: target.type,
    name: path.basename(target.path, ext),
  };

  const handler = EXT_HANDLERS[ext];
  if (handler) {
    const sub = handler(target, opts, idx);
    if (sub.error) return { ...result, error: sub.error };
    Object.assign(result, sub);
    return result;
  }

  // Generic fallback: just stat the file.
  try {
    const stat = fs.statSync(path.join(idx.root, target.physicalPath || target.path));
    result.sizeBytes = stat.size;
    result.lastModified = new Date(stat.mtimeMs).toISOString();
  } catch { /* tolerate */ }
  return result;
}

function inspectAssets(args) {
  if (!Array.isArray(args.paths) || args.paths.length === 0) {
    return { error: "'paths' is required and must be a non-empty array of asset paths." };
  }
  const items = [];
  let succeeded = 0, failed = 0;
  for (const p of args.paths) {
    if (typeof p !== 'string' || p === '') {
      failed++;
      items.push({ path: null, error: 'non-string entry in paths[]' });
      continue;
    }
    const sub = inspectAsset({ ...args, assetPath: p, paths: undefined });
    if (sub.error) {
      failed++;
      items.push({ path: p, error: sub.error });
    } else {
      succeeded++;
      items.push(sub);
    }
  }
  return { count: args.paths.length, succeeded, failed, items };
}

function parseInspectionOptions(args) {
  const opts = { depth: -1, includeTransforms: false, includeFields: false };
  if (args.depth !== undefined) opts.depth = parseInt(args.depth, 10);
  if (args.includeTransforms === true || args.includeTransforms === 'true') opts.includeTransforms = true;
  if (args.includeFields === true || args.includeFields === 'true') opts.includeFields = true;
  return opts;
}

function resolveTarget(args, idx) {
  if (args.guid) {
    const e = idx.byGuid.get(String(args.guid).toLowerCase());
    if (!e) return { error: `Asset GUID not found: ${args.guid}` };
    return { path: e.path, physicalPath: e.physicalPath || e.path, guid: e.guid, type: e.type, entry: e };
  }
  if (args.assetPath) {
    const p = String(args.assetPath).replace(/\\/g, '/');
    const e = idx.byPath.get(p);
    if (!e) return { error: `Asset not found: ${p}` };
    return { path: e.path, physicalPath: e.physicalPath || e.path, guid: e.guid, type: e.type, entry: e };
  }
  return { error: "Target not found. Provide 'assetPath' or 'guid'." };
}

// ── .prefab ────────────────────────────────────────────────────────────────

function inspectPrefab(target, opts, idx) {
  const fullPath = path.join(idx.root, target.physicalPath || target.path);
  let text;
  try { text = fs.readFileSync(fullPath, 'utf8'); }
  catch (e) { return { error: `Failed to read prefab: ${e.message}` }; }

  let docs;
  try { docs = parseUnityYaml(text); }
  catch (e) { return { error: `YAML parse error: ${e.message}` }; }

  // Index docs by fileId.
  const byFileId = new Map();
  for (const d of docs) byFileId.set(d.fileId, d);

  // Prefab variants — flagged by a PrefabInstance (classId 1001) document
  // that references a base prefab via m_SourcePrefab. We can't resolve the
  // effective hierarchy without recursively loading + applying overrides,
  // which is complex; signal the dispatcher to fall back to Unity-side.
  const variantDoc = docs.find(d => d.classId === 1001);
  if (variantDoc) {
    return { error: 'PREFAB_VARIANT_NOT_SUPPORTED' };
  }

  const gameObjects = docs.filter(d => d.classId === 1);
  if (gameObjects.length === 0) {
    return { error: 'No GameObject documents found in prefab' };
  }

  // Find root: GameObject whose Transform has m_Father pointing to fileID 0.
  const root = pickRoot(gameObjects, byFileId);
  if (!root) return { error: 'Could not identify root GameObject in prefab' };

  return buildNode(root, byFileId, idx, opts, 0);
}

function pickRoot(gameObjects, byFileId) {
  for (const go of gameObjects) {
    const body = go.body.GameObject;
    const components = body.m_Component || [];
    for (const c of components) {
      const ref = c.component;
      if (!ref || ref.fileID === undefined) continue;
      const trDoc = byFileId.get(String(ref.fileID));
      if (!trDoc) continue;
      const trBody = trDoc.body.Transform || trDoc.body.RectTransform;
      if (!trBody) continue;
      const father = trBody.m_Father;
      if (!father || father.fileID === 0 || father.fileID === '0') return go;
    }
  }
  // Fallback: first GameObject.
  return gameObjects[0];
}

function buildNode(goDoc, byFileId, idx, opts, currentDepth) {
  const body = goDoc.body.GameObject;
  const node = {
    name: body.m_Name,
    instanceId: numericFileId(goDoc.fileId),
    active: body.m_IsActive === 1 || body.m_IsActive === true,
    tag: body.m_TagString != null ? String(body.m_TagString) : 'Untagged',
    layer: typeof body.m_Layer === 'number' ? body.m_Layer : 0,
    isStatic: !!body.m_StaticEditorFlags && body.m_StaticEditorFlags !== 0,
  };

  // Components — first pass to find Transform for transform info + children.
  const compRefs = (body.m_Component || []).map(c => c.component).filter(Boolean);
  const compDocs = compRefs
    .map(r => byFileId.get(String(r.fileID)))
    .filter(Boolean);

  // Find transform (Transform / RectTransform).
  const transformDoc = compDocs.find(d => d.classId === 4 || d.classId === 224);

  if (opts.includeTransforms && transformDoc) {
    const trBody = transformDoc.body.Transform || transformDoc.body.RectTransform;
    node.transform = {
      localPosition: trBody.m_LocalPosition || { x: 0, y: 0, z: 0 },
      localEulerAngles: trBody.m_LocalEulerAnglesHint || { x: 0, y: 0, z: 0 },
      localScale: trBody.m_LocalScale || { x: 1, y: 1, z: 1 },
    };
  }

  // Component summary.
  node.components = compDocs.map(d => describeComponent(d));

  // Children walk via Transform.m_Children.
  const childRefs = transformDoc
    ? extractChildren(transformDoc.body.Transform || transformDoc.body.RectTransform)
    : [];
  node.childCount = childRefs.length;

  const recurse = opts.depth < 0 || currentDepth < opts.depth;
  if (recurse && childRefs.length > 0) {
    node.children = [];
    for (const childRef of childRefs) {
      const childTransformDoc = byFileId.get(String(childRef.fileID));
      if (!childTransformDoc) continue;
      const goRef = (childTransformDoc.body.Transform || childTransformDoc.body.RectTransform || {}).m_GameObject;
      if (!goRef) continue;
      const childGo = byFileId.get(String(goRef.fileID));
      if (!childGo) continue;
      node.children.push(buildNode(childGo, byFileId, idx, opts, currentDepth + 1));
    }
  }

  return node;
}

function extractChildren(trBody) {
  const list = trBody.m_Children;
  if (!Array.isArray(list)) return [];
  // Each entry is `{fileID: ...}`. The flow-map parser returns the object as-is.
  return list.filter(c => c && c.fileID !== undefined);
}

function describeComponent(doc) {
  const typeKey = Object.keys(doc.body)[0];
  let typeName = typeKey;
  let fullName = `UnityEngine.${typeKey}`;
  let enabled = true;

  if (doc.classId === 114) {
    // MonoBehaviour — resolve actual script class.
    const monoBody = doc.body.MonoBehaviour;
    const scriptRef = monoBody && monoBody.m_Script;
    if (scriptRef && scriptRef.guid) {
      const resolved = resolveScript(scriptRef.guid);
      if (resolved) {
        typeName = resolved.name;
        fullName = resolved.fullName || resolved.name;
      } else {
        typeName = 'MonoBehaviour';
        fullName = `UnityEngine.MonoBehaviour`;
      }
    }
    if (monoBody && (monoBody.m_Enabled === 0 || monoBody.m_Enabled === false)) enabled = false;
  } else {
    // Built-in component — name from class ID, more reliable than the YAML key.
    const idName = classIdToName(doc.classId);
    if (idName && !idName.startsWith('ClassId<')) {
      typeName = idName;
      fullName = `UnityEngine.${idName}`;
    }
    const body = doc.body[typeKey];
    if (HAS_M_ENABLED.has(doc.classId) && body && (body.m_Enabled === 0 || body.m_Enabled === false)) {
      enabled = false;
    }
  }

  return { type: typeName, fullType: fullName, enabled };
}

function numericFileId(fid) {
  if (fid == null) return null;
  const n = Number(fid);
  if (Number.isSafeInteger(n)) return n;
  return String(fid);
}

// ── .unity (scene) ─────────────────────────────────────────────────────────
//
// A scene contains many GameObjects. We mimic Unity-side InspectScene which
// returns a flat list of root-level GameObjects (no recursion — that's
// `inspect_hierarchy` territory and lives in scene runtime state we don't have).

function inspectScene(target, opts, idx) {
  const fullPath = path.join(idx.root, target.physicalPath || target.path);
  let text;
  try { text = fs.readFileSync(fullPath, 'utf8'); }
  catch (e) { return { error: `Failed to read scene: ${e.message}` }; }

  let docs;
  try { docs = parseUnityYaml(text); }
  catch (e) { return { error: `YAML parse error: ${e.message}` }; }

  // Scene with prefab instances — Unity expands them at load time. Without a
  // recursive resolver we'd misreport components, so signal fallback.
  const variantDoc = docs.find(d => d.classId === 1001);
  if (variantDoc) {
    return { error: 'SCENE_HAS_PREFAB_INSTANCES' };
  }

  const byFileId = new Map();
  for (const d of docs) byFileId.set(d.fileId, d);

  const gameObjects = docs.filter(d => d.classId === 1);
  const rootNodes = [];
  for (const go of gameObjects) {
    const body = go.body.GameObject;
    const components = body.m_Component || [];
    let isRoot = false;
    for (const c of components) {
      const ref = c.component;
      if (!ref || ref.fileID === undefined) continue;
      const trDoc = byFileId.get(String(ref.fileID));
      if (!trDoc) continue;
      const trBody = trDoc.body.Transform || trDoc.body.RectTransform;
      if (!trBody) continue;
      const father = trBody.m_Father;
      if (!father || father.fileID === 0 || father.fileID === '0') isRoot = true;
      break;
    }
    if (isRoot) rootNodes.push(buildNode(go, byFileId, idx, opts, 0));
  }
  return {
    rootGameObjectCount: rootNodes.length,
    rootGameObjects: rootNodes,
  };
}

// ── Per-command Node-side entry points (each matches its Unity-side handler's output shape) ──

// Used by inspect-material. Returns the same shape as MaterialOps.InspectMaterial.
function inspectMaterialCommand(args) {
  const idx = loadIndex();
  const target = resolveTarget(args, idx);
  if (target.error) return target;
  const fullPath = path.join(idx.root, target.physicalPath || target.path);
  let text;
  try { text = fs.readFileSync(fullPath, 'utf8'); }
  catch (e) { return { error: `Failed to read material: ${e.message}` }; }
  let docs;
  try { docs = parseUnityYaml(text); }
  catch (e) { return { error: `YAML parse error: ${e.message}` }; }
  return typed.inspectMaterial(target, {}, idx, docs);
}

// Used by inspect-animation-clip. Returns AnimationClipOps.InspectAnimationClip shape.
function inspectAnimationClipCommand(args) {
  const idx = loadIndex();
  const target = resolveTarget(args, idx);
  if (target.error) return target;
  const fullPath = path.join(idx.root, target.physicalPath || target.path);
  let text;
  try { text = fs.readFileSync(fullPath, 'utf8'); }
  catch (e) { return { error: `Failed to read clip: ${e.message}` }; }
  let docs;
  try { docs = parseUnityYaml(text); }
  catch (e) { return { error: `YAML parse error: ${e.message}` }; }
  const r = typed.inspectAnimationClip(target, {}, idx, docs);
  if (r.error) return r;
  return { assetPath: target.path, guid: target.guid, ...r };
}

function inspectAnimatorControllerCommand(args) {
  const idx = loadIndex();
  const target = resolveTarget(args, idx);
  if (target.error) return target;
  const fullPath = path.join(idx.root, target.physicalPath || target.path);
  let text;
  try { text = fs.readFileSync(fullPath, 'utf8'); }
  catch (e) { return { error: `Failed to read controller: ${e.message}` }; }
  let docs;
  try { docs = parseUnityYaml(text); }
  catch (e) { return { error: `YAML parse error: ${e.message}` }; }
  const r = typed.inspectAnimatorController(target, {}, idx, docs);
  if (r.error) return r;
  return { assetPath: target.path, guid: target.guid, ...r };
}

function inspectAvatarMaskCommand(args) {
  const idx = loadIndex();
  const target = resolveTarget(args, idx);
  if (target.error) return target;
  const fullPath = path.join(idx.root, target.physicalPath || target.path);
  let text;
  try { text = fs.readFileSync(fullPath, 'utf8'); }
  catch (e) { return { error: `Failed to read mask: ${e.message}` }; }
  let docs;
  try { docs = parseUnityYaml(text); }
  catch (e) { return { error: `YAML parse error: ${e.message}` }; }
  const r = typed.inspectAvatarMask(target, {}, idx, docs);
  if (r.error) return r;
  return { assetPath: target.path, guid: target.guid, ...r };
}

function inspectAnimatorOverrideControllerCommand(args) {
  const idx = loadIndex();
  const target = resolveTarget(args, idx);
  if (target.error) return target;
  const fullPath = path.join(idx.root, target.physicalPath || target.path);
  let text;
  try { text = fs.readFileSync(fullPath, 'utf8'); }
  catch (e) { return { error: `Failed to read override controller: ${e.message}` }; }
  let docs;
  try { docs = parseUnityYaml(text); }
  catch (e) { return { error: `YAML parse error: ${e.message}` }; }
  const r = typed.inspectAnimatorOverrideController(target, {}, idx, docs);
  if (r.error) return r;
  return { assetPath: target.path, guid: target.guid, ...r };
}

function inspectShaderCommand(args) {
  const idx = loadIndex();
  const target = resolveTarget(args, idx);
  if (target.error) return target;
  const fullPath = path.join(idx.root, target.physicalPath || target.path);
  let text;
  try { text = fs.readFileSync(fullPath, 'utf8'); }
  catch (e) { return { error: `Failed to read shader: ${e.message}` }; }
  const r = typed.inspectShader(target, {}, idx, null, text);
  if (r.error) return r;
  return { assetPath: target.path, guid: target.guid, ...r };
}

module.exports = {
  inspectAsset,
  inspectAssets,
  inspectMaterialCommand,
  inspectAnimationClipCommand,
  inspectAnimatorControllerCommand,
  inspectAvatarMaskCommand,
  inspectAnimatorOverrideControllerCommand,
  inspectShaderCommand,
};
