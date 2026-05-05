#!/usr/bin/env node
// Diagnostic: parse a GIF89a file, validate structure, decode LZW for every frame,
// and emit a short report. Used to verify GifEncoder.cs output without needing an
// external image viewer (or Claude's tools, which can't read GIFs).
//
//   node daemon/scripts/gif-inspect.js DreamerScreenshots/foo.gif

'use strict';

const fs = require('fs');
const path = require('path');

function fail(msg, ctx) {
  console.error(`FAIL: ${msg}`);
  if (ctx) console.error(ctx);
  process.exit(2);
}

function inspect(filePath) {
  const buf = fs.readFileSync(filePath);
  let p = 0;
  const issues = [];

  // ── Header ────────────────────────────────────────────────────────
  const sig = buf.slice(0, 6).toString('latin1');
  if (sig !== 'GIF89a' && sig !== 'GIF87a') fail(`bad signature: ${JSON.stringify(sig)}`);
  p = 6;

  // ── Logical Screen Descriptor ────────────────────────────────────
  const screenW = buf.readUInt16LE(p); p += 2;
  const screenH = buf.readUInt16LE(p); p += 2;
  const packed = buf[p]; p += 1;
  const bgIndex = buf[p]; p += 1;
  const aspect = buf[p]; p += 1;

  const gctFlag = (packed & 0x80) !== 0;
  const colorRes = ((packed >> 4) & 0x07) + 1;
  const sortFlag = (packed & 0x08) !== 0;
  const gctSize = 1 << ((packed & 0x07) + 1);

  const report = {
    file: path.basename(filePath),
    fileSize: buf.length,
    signature: sig,
    width: screenW,
    height: screenH,
    gct: gctFlag,
    gctEntries: gctFlag ? gctSize : 0,
    bgIndex,
    aspect,
    colorRes,
    frames: [],
    extensions: [],
    bytesAfterTrailer: 0,
  };

  // ── Global Color Table ───────────────────────────────────────────
  let gct = null;
  if (gctFlag) {
    gct = [];
    for (let i = 0; i < gctSize; i++) {
      gct.push([buf[p], buf[p + 1], buf[p + 2]]);
      p += 3;
    }
  }

  // ── Block loop ───────────────────────────────────────────────────
  let pendingDelay = 0;
  let pendingDisposal = 0;
  let pendingTransparent = false;
  let pendingTransIndex = 0;
  let saw89aTrailer = false;

  while (p < buf.length) {
    const intro = buf[p];
    if (intro === 0x3B) {
      saw89aTrailer = true;
      p += 1;
      break;
    }
    if (intro === 0x21) {
      // Extension.
      const label = buf[p + 1];
      p += 2;
      if (label === 0xF9) {
        // Graphic Control Extension.
        const blockSize = buf[p]; p += 1;
        if (blockSize !== 4) issues.push(`GCE block size ${blockSize}, expected 4`);
        const gpacked = buf[p]; p += 1;
        pendingDisposal = (gpacked >> 2) & 0x07;
        pendingTransparent = (gpacked & 0x01) !== 0;
        pendingDelay = buf.readUInt16LE(p); p += 2;
        pendingTransIndex = buf[p]; p += 1;
        const term = buf[p]; p += 1;
        if (term !== 0) issues.push('GCE not terminated by 0x00');
      } else if (label === 0xFF) {
        // Application extension.
        const blockSize = buf[p]; p += 1;
        const id = buf.slice(p, p + blockSize).toString('latin1');
        p += blockSize;
        const subBlocks = readSubBlocks(buf, p);
        p = subBlocks.end;
        report.extensions.push({ kind: 'application', id, dataLen: subBlocks.data.length });
      } else if (label === 0xFE) {
        // Comment extension.
        const subBlocks = readSubBlocks(buf, p);
        p = subBlocks.end;
        report.extensions.push({ kind: 'comment', dataLen: subBlocks.data.length });
      } else if (label === 0x01) {
        // Plain text — skip.
        const blockSize = buf[p]; p += 1 + blockSize;
        const subBlocks = readSubBlocks(buf, p);
        p = subBlocks.end;
        report.extensions.push({ kind: 'plaintext', dataLen: subBlocks.data.length });
      } else {
        issues.push(`unknown extension label 0x${label.toString(16)} at offset ${p - 2}`);
        const subBlocks = readSubBlocks(buf, p);
        p = subBlocks.end;
      }
      continue;
    }
    if (intro === 0x2C) {
      // Image descriptor.
      p += 1;
      const left = buf.readUInt16LE(p); p += 2;
      const top = buf.readUInt16LE(p); p += 2;
      const w = buf.readUInt16LE(p); p += 2;
      const h = buf.readUInt16LE(p); p += 2;
      const ipacked = buf[p]; p += 1;
      const lctFlag = (ipacked & 0x80) !== 0;
      const interlaced = (ipacked & 0x40) !== 0;
      const lctSize = 1 << ((ipacked & 0x07) + 1);
      let lct = null;
      if (lctFlag) {
        lct = [];
        for (let i = 0; i < lctSize; i++) {
          lct.push([buf[p], buf[p + 1], buf[p + 2]]);
          p += 3;
        }
      }
      const minCodeSize = buf[p]; p += 1;
      const subBlocks = readSubBlocks(buf, p);
      p = subBlocks.end;

      const expectedPixels = w * h;
      let decodeError = null;
      let decodedLen = 0;
      let uniqueIndices = 0;
      try {
        const decoded = decodeLzw(subBlocks.data, minCodeSize);
        decodedLen = decoded.length;
        const seen = new Set();
        for (let i = 0; i < decoded.length; i++) seen.add(decoded[i]);
        uniqueIndices = seen.size;
      } catch (e) {
        decodeError = e.message;
      }
      const frameInfo = {
        index: report.frames.length,
        left, top, w, h,
        lct: lctFlag,
        interlaced,
        minCodeSize,
        compressedBytes: subBlocks.data.length,
        decodedPixels: decodedLen,
        expectedPixels,
        uniqueIndices,
        delayMs: pendingDelay * 10,
        disposal: pendingDisposal,
        transparent: pendingTransparent,
        transIndex: pendingTransparent ? pendingTransIndex : null,
        error: decodeError,
      };
      report.frames.push(frameInfo);
      pendingDelay = 0;
      pendingDisposal = 0;
      pendingTransparent = false;
      continue;
    }
    issues.push(`unknown block 0x${intro.toString(16)} at offset ${p}`);
    p += 1;
  }

  if (!saw89aTrailer) issues.push('missing 0x3B trailer');
  report.bytesAfterTrailer = buf.length - p;
  if (report.bytesAfterTrailer > 0) issues.push(`${report.bytesAfterTrailer} stray bytes after trailer`);

  return { report, issues };
}

function readSubBlocks(buf, start) {
  let p = start;
  const chunks = [];
  while (true) {
    const len = buf[p]; p += 1;
    if (len === 0) break;
    chunks.push(buf.slice(p, p + len));
    p += len;
  }
  return { data: Buffer.concat(chunks), end: p };
}

function decodeLzw(data, minCodeSize) {
  const clearCode = 1 << minCodeSize;
  const endCode = clearCode + 1;
  const out = [];

  let codeSize = minCodeSize + 1;
  let dict = initialDict(clearCode);
  let nextCode = endCode + 1;
  let bitBuf = 0;
  let bitCnt = 0;
  let byteIdx = 0;
  let prevCode = -1;

  function readCode() {
    while (bitCnt < codeSize) {
      if (byteIdx >= data.length) return -1;
      bitBuf |= data[byteIdx++] << bitCnt;
      bitCnt += 8;
    }
    const c = bitBuf & ((1 << codeSize) - 1);
    bitBuf >>>= codeSize;
    bitCnt -= codeSize;
    return c;
  }

  while (true) {
    const code = readCode();
    if (code < 0) break;
    if (code === endCode) break;
    if (code === clearCode) {
      codeSize = minCodeSize + 1;
      dict = initialDict(clearCode);
      nextCode = endCode + 1;
      prevCode = -1;
      continue;
    }
    let entry;
    if (code < dict.length) {
      entry = dict[code];
    } else if (code === dict.length && prevCode >= 0) {
      // KwKwK case.
      const prev = dict[prevCode];
      entry = prev.concat([prev[0]]);
    } else {
      throw new Error(`code ${code} out of range (dict size ${dict.length})`);
    }
    for (let i = 0; i < entry.length; i++) out.push(entry[i]);

    if (prevCode >= 0 && nextCode < 4096) {
      const prev = dict[prevCode];
      dict.push(prev.concat([entry[0]]));
      nextCode++;
      if (nextCode === (1 << codeSize) && codeSize < 12) {
        codeSize++;
      }
    }
    prevCode = code;
  }
  return out;
}

function initialDict(clearCode) {
  const dict = [];
  for (let i = 0; i < clearCode; i++) dict.push([i]);
  dict.push(null); // clear
  dict.push(null); // end
  return dict;
}

// ── main ──────────────────────────────────────────────────────────

const arg = process.argv[2];
if (!arg) {
  console.error('usage: node gif-inspect.js <path-to-gif>');
  process.exit(1);
}
const target = path.resolve(arg);
const { report, issues } = inspect(target);
console.log('=== GIF report ===');
console.log(JSON.stringify(report, null, 2));
console.log('=== issues ===');
if (issues.length === 0) console.log('(none)');
else for (const m of issues) console.log('- ' + m);
process.exit(issues.length === 0 ? 0 : 3);
