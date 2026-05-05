'use strict';

const { commonArgs } = require('./_common');

module.exports = {
  kind: 'set_rect_transform',
  summary: 'Adjust a single uGUI element\'s RectTransform: anchor preset, size, pivot, offset/offsetMin/offsetMax. CLI verb: `set-rect-transform`. For multi-element edits or building new UI, prefer create-ui-tree (one declarative tree). Asset-targeting (--asset prefab) is not Play-Mode-gated; scene-targeting is.',
  requirements: null,
  args: {
    ...commonArgs.target(['asset', 'guid', 'scene', 'child']),
    anchor: {
      type: 'string',
      cli: '--anchor',
      description: 'Preset name: top-left, top, top-right, left, center, right, bottom-left, bottom, bottom-right, top-stretch, middle-stretch, bottom-stretch, stretch-left, stretch-center, stretch-right, fill.',
    },
    size: {
      type: 'any',
      cli: '--size',
      description: 'Sized as "WxH" (e.g. "200x60"), `[W, H]` JSON array, or `{"w":N,"h":N}` dict. Leave 0 on a stretched axis to inherit parent size.',
    },
    pivot: {
      type: 'any',
      cli: '--pivot',
      description: 'Pivot as "X,Y" string, `[X,Y]` array, or `{"x":N,"y":N}` dict (e.g. "0.5,0.5").',
    },
    offset: {
      type: 'any',
      cli: '--offset',
      description: 'Anchored position offset as "X,Y" string or `[X,Y]` array.',
    },
    offsetMin: {
      type: 'any',
      cli: '--offset-min',
      description: 'Stretched-axis-only: min offset as "X,Y" string or `[X,Y]` array. Per-axis — only applied to stretched axes.',
    },
    offsetMax: {
      type: 'any',
      cli: '--offset-max',
      description: 'Stretched-axis-only: max offset as "X,Y" string or `[X,Y]` array.',
    },
  },
  constraints: [commonArgs.targetAtLeastOne()],
  result: {
    type: 'object',
    fields: {
      set: { type: 'boolean' },
      anchorMin: { type: 'object' },
      anchorMax: { type: 'object' },
      sizeDelta: { type: 'object' },
      pivot: { type: 'object' },
      anchoredPosition: { type: 'object' },
    },
  },
  examples: [
    {
      title: 'Center a button at 200x60',
      cli: './bin/dreamer set-rect-transform --scene-object "/Canvas/Menu/PlayBtn" --anchor center --size 200x60 --wait',
      args: { sceneObjectPath: '/Canvas/Menu/PlayBtn', anchor: 'center', size: '200x60' },
    },
    {
      title: 'Stretch-fill a panel inside a prefab',
      cli: './bin/dreamer set-rect-transform --asset Assets/Prefabs/UI/Panel.prefab --child-path "Body" --anchor fill --wait',
      args: { assetPath: 'Assets/Prefabs/UI/Panel.prefab', childPath: 'Body', anchor: 'fill' },
    },
  ],
};
