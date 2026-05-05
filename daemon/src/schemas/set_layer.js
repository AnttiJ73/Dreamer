'use strict';

const { commonArgs } = require('./_common');

module.exports = {
  kind: 'set_layer',
  summary: 'Assign a Unity layer to a GameObject (scene or inside a prefab). USE THIS instead of `set-property --property m_Layer`, which fails because m_Layer lives on the GameObject anchor, not a Component. Layer can be passed by NAME (preferred — auto-resolved against ProjectSettings) or by INDEX (0–31). Pair with `set-layer-name` to manage the layer table itself.',
  requirements: null,
  args: {
    ...commonArgs.target(),
    layer: {
      type: ['string', 'number'],
      required: true,
      cli: '--layer',
      description: 'Layer name (e.g. "Terrain", "UI") OR numeric index 0–31. Names are resolved via LayerMask.NameToLayer; unknown names error with the available list.',
    },
    recursive: {
      type: 'boolean',
      cli: '--recursive',
      description: 'Apply the layer to ALL descendants too. Mirrors Unity\'s Inspector prompt "Do you want to set the layer for all child objects as well?". Default: false (only the target GameObject changes).',
    },
  },
  constraints: [commonArgs.targetAtLeastOne()],
  result: {
    type: 'object',
    fields: {
      set: { type: 'boolean' },
      layerIndex: { type: 'number' },
      layerName: { type: 'string' },
      previousLayerIndex: { type: 'number' },
      previousLayerName: { type: 'string' },
      path: { type: 'string', description: 'Updated scene path (scene mode) or asset+childPath (prefab mode).' },
      appliedToCount: { type: 'number', description: '1 if --recursive false, else (1 + descendant count).' },
    },
  },
  examples: [
    {
      title: 'Assign by layer name (scene)',
      cli: './bin/dreamer set-layer --scene-object "/Grid/Tilemap" --layer Terrain --wait',
      args: { sceneObjectPath: '/Grid/Tilemap', layer: 'Terrain' },
    },
    {
      title: 'Assign by index, recursively (scene)',
      cli: './bin/dreamer set-layer --scene-object "/Player" --layer 8 --recursive --wait',
      args: { sceneObjectPath: '/Player', layer: 8, recursive: true },
    },
    {
      title: 'Assign to a prefab child',
      cli: './bin/dreamer set-layer --asset Assets/Prefabs/Enemy.prefab --child-path "Visuals/Body" --layer Enemy --wait',
      args: { assetPath: 'Assets/Prefabs/Enemy.prefab', childPath: 'Visuals/Body', layer: 'Enemy' },
    },
  ],
  pitfalls: [
    'DO NOT use `set-property --property m_Layer`. The CLI now intercepts this with a directive error pointing here.',
    'Layer NAMES must already exist in the project. Add them first with `set-layer-name --index N --name NAME`. The error includes the current named-layer list so you can spot typos.',
    'INDEX must be 0–31 (Unity\'s 32-bit layer mask). Indices above 31 are rejected.',
    '`--recursive` mirrors Unity\'s "set children too?" prompt. Without it, only the named GameObject changes — descendants keep their existing layers (which is sometimes what you want, e.g. UI under a Default-layer canvas).',
    'After scene-mode set, `save-assets --wait` to persist. Prefab-mode writes the prefab asset directly.',
  ],
};
