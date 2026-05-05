'use strict';

// Hand-rolled PNG encoder. Built-in zlib only — no external deps.
// Format: signature + IHDR + IDAT (zlib-deflated raw scanlines) + IEND.
// Each scanline is prefixed by a filter byte (0 = None — we don't try to
// optimize compression with adaptive filtering; deflate alone gets ~30% on
// procedural textures and that's good enough for our use case).

const zlib = require('zlib');

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

// Pre-compute CRC table once. Standard PNG / IEEE 802.3 polynomial.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'latin1');
  const crcInput = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

/**
 * Encode raw RGBA pixel data to a PNG buffer.
 * @param {Buffer|Uint8Array} rgba  width*height*4 bytes, top-to-bottom rows.
 * @param {number} width
 * @param {number} height
 * @returns {Buffer}
 */
function encodePNG(rgba, width, height) {
  if (rgba.length !== width * height * 4)
    throw new Error(`encodePNG: pixel buffer length ${rgba.length} != ${width}*${height}*4`);

  // IHDR.
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8);    // bit depth
  ihdr.writeUInt8(6, 9);    // color type 6 = RGBA
  ihdr.writeUInt8(0, 10);   // compression method
  ihdr.writeUInt8(0, 11);   // filter method
  ihdr.writeUInt8(0, 12);   // interlace method

  // Filter: prepend 0 (None) to every scanline.
  const stride = width * 4;
  const filtered = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    filtered[y * (stride + 1)] = 0;
    rgba.copy
      ? rgba.copy(filtered, y * (stride + 1) + 1, y * stride, y * stride + stride)
      : Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(filtered, y * (stride + 1) + 1);
  }

  const idatData = zlib.deflateSync(filtered, { level: 6 });

  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', idatData),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

module.exports = { encodePNG };
