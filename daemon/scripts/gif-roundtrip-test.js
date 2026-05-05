#!/usr/bin/env node
// Port the C# GifEncoder LZW to JS and round-trip against the same JS decoder
// used in gif-inspect.js. If round-trip fails, the algorithm itself is broken.
// If round-trip works, the bug is in the C# implementation specifically.

'use strict';

function encodeLzw(pixels, minCodeSize) {
  const clearCode = 1 << minCodeSize;
  const endCode = clearCode + 1;
  const maxDictSize = 4096;
  let codeSize = minCodeSize + 1;
  let nextCode = endCode + 1;
  const dict = new Map();

  // Mirrors C# BitOutput LSB-first packing.
  const buffer = [];
  let curByte = 0;
  let bitsInByte = 0;
  function writeCode(code, width) {
    for (let i = 0; i < width; i++) {
      const bit = (code >>> i) & 1;
      curByte |= bit << bitsInByte;
      bitsInByte++;
      if (bitsInByte === 8) {
        buffer.push(curByte & 0xFF);
        curByte = 0;
        bitsInByte = 0;
      }
    }
  }
  function flush() {
    if (bitsInByte > 0) {
      buffer.push(curByte & 0xFF);
      curByte = 0;
      bitsInByte = 0;
    }
  }

  writeCode(clearCode, codeSize);

  let prefix = pixels[0];
  for (let i = 1; i < pixels.length; i++) {
    const sym = pixels[i];
    const key = (prefix << 8) | sym;
    if (dict.has(key)) {
      prefix = dict.get(key);
    } else {
      writeCode(prefix, codeSize);
      if (nextCode < maxDictSize) {
        dict.set(key, nextCode);
        nextCode++;
        if (nextCode > (1 << codeSize) && codeSize < 12) codeSize++;
      } else {
        writeCode(clearCode, codeSize);
        dict.clear();
        codeSize = minCodeSize + 1;
        nextCode = endCode + 1;
      }
      prefix = sym;
    }
  }
  writeCode(prefix, codeSize);
  writeCode(endCode, codeSize);
  flush();

  return Buffer.from(buffer);
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
      if (nextCode === (1 << codeSize) && codeSize < 12) codeSize++;
    }
    prevCode = code;
  }
  return out;
}

function initialDict(clearCode) {
  const dict = [];
  for (let i = 0; i < clearCode; i++) dict.push([i]);
  dict.push(null);
  dict.push(null);
  return dict;
}

function check(name, pixels) {
  const encoded = encodeLzw(pixels, 8);
  const decoded = decodeLzw(encoded, 8);
  const ok = decoded.length === pixels.length && decoded.every((v, i) => v === pixels[i]);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: in=${pixels.length} compressed=${encoded.length} decoded=${decoded.length}`);
  if (!ok) {
    let firstDiff = -1;
    const lim = Math.min(pixels.length, decoded.length);
    for (let i = 0; i < lim; i++) if (pixels[i] !== decoded[i]) { firstDiff = i; break; }
    console.log(`  first divergence: idx ${firstDiff} expected ${pixels[firstDiff]} got ${decoded[firstDiff]}`);
    console.log(`  pixels[0..20] = [${pixels.slice(0, 20).join(',')}]`);
    console.log(`  decoded[0..20] = [${decoded.slice(0, 20).join(',')}]`);
  }
  return ok;
}

// Tests.
check('zeros 1024', new Uint8Array(1024));
check('alternating AB 256', Uint8Array.from(Array.from({ length: 256 }, (_, i) => i & 1)));
check('counting 0..255', Uint8Array.from(Array.from({ length: 256 }, (_, i) => i)));
check('repeated counting 4096', Uint8Array.from(Array.from({ length: 4096 }, (_, i) => i & 0xFF)));

const bigZeros = new Uint8Array(262144);
check('262144 zeros (sim particle bg)', bigZeros);

const bigPattern = Uint8Array.from(Array.from({ length: 262144 }, (_, i) => (i * 31 + (i >> 4)) & 0xFF));
check('262144 pseudo-noise', bigPattern);
