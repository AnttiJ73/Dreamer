'use strict';

// Per-asset-type inspectors that work directly on the YAML body (post-parse).
// Output shape mirrors the corresponding Unity-side handler so downstream
// code doesn't need to know which path produced the result.
//
// Each function takes `(target, opts, idx, docs)` and returns the inspector
// body (without the `path/guid/type/name` envelope — `inspect.js` adds that).

const { entryByGuid } = require('./asset-index');

// ── .mat / Material ────────────────────────────────────────────────────────

// Match Unity-side InspectMaterial output:
//   { assetPath, guid, shader, renderQueue, properties[], keywords[] }
//
// `properties[]` merges TexEnvs / Floats / Colors / Vectors / Ints into one
// list with `{name, displayName, type, value, ...}` per entry.
//
// Limitations vs Unity:
//   • `displayName` and `type` (Float vs Range) require ShaderUtil — Node
//     doesn't have access. We default `displayName` to the property name
//     and `type` based on which list (TexEnv / Color / Vector / Float / Int)
//     held the value. Range bounds (rangeMin / rangeMax) are absent.
//   • Property ORDER matches the YAML list order (alphabetical), not the
//     shader's declared order. Unity-side returns shader-declared order.
function inspectMaterial(target, opts, idx, docs) {
  const matDoc = docs.find(d => d.classId === 21);
  if (!matDoc) return { error: 'No Material document found' };
  const body = matDoc.body.Material;
  if (!body) return { error: 'Material body missing' };

  // Shader resolution: project shaders resolve via guid index. Built-in
  // shaders (`0000...0000f000...` GUID) can't be resolved without Unity
  // because they're compiled into the engine — emit `null`.
  let shaderName = null;
  const shaderRef = body.m_Shader;
  if (shaderRef && shaderRef.guid) {
    const sEntry = entryByGuid(shaderRef.guid);
    if (sEntry) {
      // Try to read the shader's declared name from its file.
      try {
        const fs = require('fs');
        const path = require('path');
        const text = fs.readFileSync(path.join(idx.root, sEntry.path), 'utf8');
        const m = /^\s*Shader\s+"([^"]+)"/m.exec(text);
        if (m) shaderName = m[1];
      } catch { /* ignore */ }
      if (!shaderName) shaderName = sEntry.path;
    }
  }

  const saved = body.m_SavedProperties || {};
  const properties = [];

  for (const { name, value } of listOfTagged(saved.m_TexEnvs)) {
    properties.push({
      name, displayName: name, type: 'TexEnv',
      value: refToPath(value && value.m_Texture, idx),
      scale: value && value.m_Scale,
      offset: value && value.m_Offset,
    });
  }
  for (const { name, value } of listOfTagged(saved.m_Colors)) {
    properties.push({ name, displayName: name, type: 'Color', value });
  }
  for (const { name, value } of listOfTagged(saved.m_Floats)) {
    properties.push({ name, displayName: name, type: 'Float', value });
  }
  for (const { name, value } of listOfTagged(saved.m_Ints || [])) {
    properties.push({ name, displayName: name, type: 'Int', value });
  }

  return {
    assetPath: target.path,
    guid: target.guid,
    shader: shaderName,
    renderQueue: typeof body.m_CustomRenderQueue === 'number' ? body.m_CustomRenderQueue : -1,
    properties,
    keywords: Array.isArray(body.m_ValidKeywords) ? body.m_ValidKeywords : [],
  };
}

// .mat YAML uses a particular shape for property lists:
//   m_Floats:
//   - _Foo: 1.0
//   - _Bar: 2.5
// Each entry is a single-key map where the key is the property name. This
// converts to a friendlier {name, value} pair shape.
function listOfTagged(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const e of list) {
    if (!e || typeof e !== 'object') continue;
    const k = Object.keys(e)[0];
    if (!k) continue;
    out.push({ name: k, value: e[k] });
  }
  return out;
}

function refToPath(ref, idx) {
  if (!ref || ref.fileID === 0 || ref.fileID === '0' || !ref.guid) return null;
  const e = idx.byGuid.get(String(ref.guid).toLowerCase());
  return e ? e.path : null;
}

// ── .shader ────────────────────────────────────────────────────────────────

function inspectShader(target, opts, idx, _docs, fullText) {
  // Shaders are surface text, not multi-doc YAML. Just scan for the Shader
  // declaration line.
  const m = /^\s*Shader\s+"([^"]+)"/m.exec(fullText || '');
  return {
    shaderName: m ? m[1] : null,
    sizeBytes: fullText ? Buffer.byteLength(fullText, 'utf8') : null,
  };
}

// ── .anim / AnimationClip ──────────────────────────────────────────────────

function inspectAnimationClip(target, opts, idx, docs) {
  const clipDoc = docs.find(d => d.classId === 74);
  if (!clipDoc) return { error: 'No AnimationClip document found' };
  const body = clipDoc.body.AnimationClip;
  if (!body) return { error: 'AnimationClip body missing' };

  const floatCurves = (body.m_FloatCurves || []).map(c => ({
    target: c.path || '',
    componentType: typeNameFromClassId(c.classID),
    propertyName: c.attribute,
    keyframeCount: countCurveKeys(c.curve),
  }));
  const objectCurves = (body.m_PPtrCurves || []).map(c => ({
    target: c.path || '',
    componentType: typeNameFromClassId(c.classID),
    propertyName: c.attribute,
    keyframeCount: Array.isArray(c.curve) ? c.curve.length : 0,
  }));
  const positionCurves = (body.m_PositionCurves || []).map(c => ({
    target: c.path || '',
    keyframeCount: countCurveKeys(c.curve),
  }));
  const rotationCurves = (body.m_RotationCurves || []).map(c => ({
    target: c.path || '',
    keyframeCount: countCurveKeys(c.curve),
  }));
  const eulerCurves = (body.m_EulerCurves || []).map(c => ({
    target: c.path || '',
    keyframeCount: countCurveKeys(c.curve),
  }));
  const scaleCurves = (body.m_ScaleCurves || []).map(c => ({
    target: c.path || '',
    keyframeCount: countCurveKeys(c.curve),
  }));

  return {
    name: body.m_Name || target.name,
    length: typeof body.m_AnimationClipSettings?.m_StopTime === 'number'
      ? body.m_AnimationClipSettings.m_StopTime
      : null,
    sampleRate: body.m_SampleRate ?? null,
    wrapMode: body.m_WrapMode ?? null,
    legacy: body.m_Legacy === 1,
    floatCurves,
    objectCurves,
    positionCurves,
    rotationCurves,
    eulerCurves,
    scaleCurves,
    totalCurveCount:
      floatCurves.length + objectCurves.length + positionCurves.length +
      rotationCurves.length + eulerCurves.length + scaleCurves.length,
    eventCount: Array.isArray(body.m_Events) ? body.m_Events.length : 0,
  };
}

function typeNameFromClassId(id) {
  const { classIdToName } = require('./class-ids');
  if (id == null) return null;
  return classIdToName(typeof id === 'number' ? id : parseInt(id, 10));
}

function countCurveKeys(curveObj) {
  if (!curveObj) return 0;
  if (Array.isArray(curveObj.m_Curve)) return curveObj.m_Curve.length;
  if (Array.isArray(curveObj)) return curveObj.length;
  return 0;
}

// ── .controller / AnimatorController ───────────────────────────────────────

function inspectAnimatorController(target, opts, idx, docs) {
  const ctrlDoc = docs.find(d => d.classId === 91);
  if (!ctrlDoc) return { error: 'No AnimatorController document found' };
  const body = ctrlDoc.body.AnimatorController;
  if (!body) return { error: 'AnimatorController body missing' };

  const layers = (body.m_AnimatorLayers || []).map(l => ({
    name: l.m_Name,
    blendingMode: l.m_BlendingMode,
    defaultWeight: l.m_DefaultWeight,
    iKPass: l.m_IKPass === 1,
    syncedLayerIndex: l.m_SyncedLayerIndex,
  }));
  const params = (body.m_AnimatorParameters || []).map(p => ({
    name: p.m_Name,
    type: paramTypeName(p.m_Type),
    defaultBool: p.m_DefaultBool,
    defaultFloat: p.m_DefaultFloat,
    defaultInt: p.m_DefaultInt,
  }));

  // States live in nested AnimatorStateMachine docs (classId 1107) referenced from
  // the layer's m_StateMachine fileID. Count them by scanning docs.
  const stateMachineDocs = docs.filter(d => d.classId === 1107);
  const stateDocs = docs.filter(d => d.classId === 1102);
  const transitionDocs = docs.filter(d => d.classId === 1101);

  return {
    name: body.m_Name || target.name,
    layers,
    parameters: params,
    stateMachineCount: stateMachineDocs.length,
    stateCount: stateDocs.length,
    transitionCount: transitionDocs.length,
    states: stateDocs.map(d => ({
      name: d.body.AnimatorState?.m_Name,
      speed: d.body.AnimatorState?.m_Speed,
    })),
  };
}

function paramTypeName(t) {
  // m_Type: 1=Float, 3=Int, 4=Bool, 9=Trigger
  switch (t) {
    case 1: return 'Float';
    case 3: return 'Int';
    case 4: return 'Bool';
    case 9: return 'Trigger';
    default: return `Unknown(${t})`;
  }
}

// ── .mask / AvatarMask ─────────────────────────────────────────────────────

function inspectAvatarMask(target, opts, idx, docs) {
  const maskDoc = docs.find(d => d.classId === 319);
  if (!maskDoc) return { error: 'No AvatarMask document found' };
  const body = maskDoc.body.AvatarMask;
  if (!body) return { error: 'AvatarMask body missing' };

  return {
    name: body.m_Name || target.name,
    bodyPartFlags: body.m_Mask || [],
    transformPaths: (body.m_Elements || []).map(e => ({ path: e.m_Path, weight: e.m_Weight })),
  };
}

// ── .overrideController / AnimatorOverrideController ──────────────────────

function inspectAnimatorOverrideController(target, opts, idx, docs) {
  const ovrDoc = docs.find(d => d.classId === 221);
  if (!ovrDoc) return { error: 'No AnimatorOverrideController document found' };
  const body = ovrDoc.body.AnimatorOverrideController;
  if (!body) return { error: 'AnimatorOverrideController body missing' };

  const baseRef = body.m_Controller;
  const baseEntry = baseRef && baseRef.guid ? entryByGuid(baseRef.guid) : null;

  const overrides = (body.m_Clips || []).map(c => ({
    originalClipPath: refToPath(c.m_OriginalClip, idx),
    overrideClipPath: refToPath(c.m_OverrideClip, idx),
  }));

  return {
    name: body.m_Name || target.name,
    baseController: baseEntry ? baseEntry.path : null,
    overrides,
  };
}

// ── ScriptableObject (.asset) ─────────────────────────────────────────────

function inspectScriptableObject(target, opts, idx, docs) {
  // SOs are stored as MonoBehaviour docs (classId 114). Multiple per file
  // are possible (sub-assets); pick the main object via main fileID from .meta.
  const monoDocs = docs.filter(d => d.classId === 114);
  if (monoDocs.length === 0) return null;

  const mainDoc = monoDocs[0];
  const body = mainDoc.body.MonoBehaviour;
  if (!body) return null;

  const scriptInfo = body.m_Script && body.m_Script.guid
    ? require('./script-resolver').resolveScript(body.m_Script.guid)
    : null;

  // Surface ALL serialized fields except Unity bookkeeping ones. Useful for
  // tweakable ScriptableObjects (config / data assets).
  const fields = {};
  const SKIP = new Set(['m_ObjectHideFlags', 'm_CorrespondingSourceObject', 'm_PrefabInstance', 'm_PrefabAsset', 'm_GameObject', 'm_Enabled', 'm_EditorHideFlags', 'm_Script', 'm_Name', 'm_EditorClassIdentifier']);
  for (const [k, v] of Object.entries(body)) {
    if (SKIP.has(k)) continue;
    fields[k] = v;
  }

  return {
    name: body.m_Name || target.name,
    scriptType: scriptInfo ? scriptInfo.fullName : null,
    scriptPath: scriptInfo ? scriptInfo.path : null,
    subAssetCount: monoDocs.length,
    fields,
  };
}

module.exports = {
  inspectMaterial,
  inspectShader,
  inspectAnimationClip,
  inspectAnimatorController,
  inspectAvatarMask,
  inspectAnimatorOverrideController,
  inspectScriptableObject,
};
