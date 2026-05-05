'use strict';

module.exports = {
  kind: 'set_cursor_icon',
  summary:
    "Set the Default Cursor (Player Settings → Other Settings → Default Cursor). CLI verb: `set-cursor-icon`. " +
    "Optional --hotspot sets the cursor click point (defaults to (0,0) — top-left of the texture). " +
    "Cursor texture format must be readable; the importer should be set to `Cursor` type or `Default` with Read/Write enabled.",
  requirements: null,
  args: {
    texture: { type: 'string', required: true, cli: '--texture', description: 'Asset path to the cursor Texture2D.' },
    hotspot: { type: 'array', cli: '--hotspot', description: 'Optional `[x,y]` pixel offset of the click point. Defaults to `[0,0]`.' },
  },
  result: {
    type: 'object',
    fields: { texture: { type: 'string' }, hotspot: { type: 'array' }, set: { type: 'boolean' } },
  },
  examples: [
    {
      title: 'Set cursor with hotspot at (16,16)',
      cli: "./bin/dreamer set-cursor-icon --texture Assets/Cursors/Pointer.png --hotspot '[16,16]' --wait",
      args: { texture: 'Assets/Cursors/Pointer.png', hotspot: [16, 16] },
    },
  ],
};
