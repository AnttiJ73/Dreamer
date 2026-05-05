using System;
using System.Collections.Generic;
using System.IO;
using UnityEngine;

namespace Dreamer.AgentBridge.FX
{
    /// <summary>
    /// Self-contained GIF89a encoder. Quantizes input frames to a global 256-color palette
    /// via median-cut, LZW-compresses the indexed pixel data, wraps with a Netscape
    /// application extension for looping. No external dependencies.
    ///
    /// Limitations: single global palette across all frames (frame-to-frame palette drift
    /// would need per-frame quantization + local color tables — not worth the complexity for
    /// VFX previews where the dominant colors are usually stable).
    /// </summary>
    public static class GifEncoder
    {
        public static byte[] Encode(Texture2D[] frames, int delayMs, int loopCount = 0)
        {
            if (frames == null || frames.Length == 0)
                throw new ArgumentException("No frames provided.");
            int width = frames[0].width;
            int height = frames[0].height;
            for (int i = 1; i < frames.Length; i++)
                if (frames[i].width != width || frames[i].height != height)
                    throw new ArgumentException($"Frame {i} dimensions differ from frame 0.");

            QuantizeToGlobalPalette(frames, out var palette, out var indexed);

            using (var ms = new MemoryStream())
            {
                // Header.
                foreach (var ch in "GIF89a") ms.WriteByte((byte)ch);

                // Logical Screen Descriptor.
                WriteShort(ms, width);
                WriteShort(ms, height);
                ms.WriteByte(0xF7); // GCT flag(1) | color res(7) | sort(0) | GCT size(7) → 256 entries
                ms.WriteByte(0);    // background color index
                ms.WriteByte(0);    // pixel aspect ratio

                // Global Color Table (256 × 3 bytes).
                for (int i = 0; i < 256; i++)
                {
                    var c = palette[i];
                    ms.WriteByte(c.r); ms.WriteByte(c.g); ms.WriteByte(c.b);
                }

                // Netscape application extension — loop count.
                ms.WriteByte(0x21); ms.WriteByte(0xFF); ms.WriteByte(11);
                foreach (var ch in "NETSCAPE2.0") ms.WriteByte((byte)ch);
                ms.WriteByte(3);
                ms.WriteByte(1);
                WriteShort(ms, loopCount);
                ms.WriteByte(0);

                int delayCs = Mathf.Max(2, delayMs / 10);
                for (int f = 0; f < frames.Length; f++)
                {
                    // Graphic Control Extension.
                    ms.WriteByte(0x21); ms.WriteByte(0xF9); ms.WriteByte(4);
                    ms.WriteByte(0x04); // disposal=1 (do not dispose), no transparency, no user input
                    WriteShort(ms, delayCs);
                    ms.WriteByte(0);
                    ms.WriteByte(0);

                    // Image Descriptor.
                    ms.WriteByte(0x2C);
                    WriteShort(ms, 0); WriteShort(ms, 0);
                    WriteShort(ms, width); WriteShort(ms, height);
                    ms.WriteByte(0); // no LCT, not interlaced

                    // LZW image data.
                    ms.WriteByte(8); // LZW minimum code size
                    WriteLZW(ms, indexed[f]);
                }

                ms.WriteByte(0x3B); // trailer
                return ms.ToArray();
            }
        }

        // ── Median-cut quantization ─────────────────────────────────────────

        static void QuantizeToGlobalPalette(Texture2D[] frames, out Color32[] palette, out byte[][] indexed)
        {
            // Sample pixels — cap per-frame to bound memory + sort cost on big frames.
            const int MaxSamplesPerFrame = 50000;
            var samples = new List<Color32>(MaxSamplesPerFrame * frames.Length);
            foreach (var tex in frames)
            {
                var px = tex.GetPixels32();
                if (px.Length <= MaxSamplesPerFrame)
                    samples.AddRange(px);
                else
                {
                    int step = px.Length / MaxSamplesPerFrame;
                    for (int i = 0; i < px.Length; i += step) samples.Add(px[i]);
                }
            }

            var buckets = new List<List<Color32>> { samples };
            while (buckets.Count < 256)
            {
                int bestIdx = -1;
                int bestRange = -1;
                int bestAxis = 0;
                for (int i = 0; i < buckets.Count; i++)
                {
                    var b = buckets[i];
                    if (b.Count <= 1) continue;
                    int rMin = 255, rMax = 0, gMin = 255, gMax = 0, bMin = 255, bMax = 0;
                    foreach (var c in b)
                    {
                        if (c.r < rMin) rMin = c.r; if (c.r > rMax) rMax = c.r;
                        if (c.g < gMin) gMin = c.g; if (c.g > gMax) gMax = c.g;
                        if (c.b < bMin) bMin = c.b; if (c.b > bMax) bMax = c.b;
                    }
                    int rR = rMax - rMin, gR = gMax - gMin, bR = bMax - bMin;
                    int axisRange = Math.Max(rR, Math.Max(gR, bR));
                    if (axisRange > bestRange)
                    {
                        bestRange = axisRange;
                        bestIdx = i;
                        bestAxis = (rR >= gR && rR >= bR) ? 0 : (gR >= bR ? 1 : 2);
                    }
                }
                if (bestIdx < 0 || bestRange == 0) break;

                var splitMe = buckets[bestIdx];
                int axis = bestAxis;
                splitMe.Sort((a, b) =>
                {
                    int va = axis == 0 ? a.r : (axis == 1 ? a.g : a.b);
                    int vb = axis == 0 ? b.r : (axis == 1 ? b.g : b.b);
                    return va.CompareTo(vb);
                });
                int mid = splitMe.Count / 2;
                var left = splitMe.GetRange(0, mid);
                var right = splitMe.GetRange(mid, splitMe.Count - mid);
                buckets[bestIdx] = left;
                buckets.Add(right);
            }

            palette = new Color32[256];
            for (int i = 0; i < palette.Length; i++)
            {
                if (i < buckets.Count && buckets[i].Count > 0)
                {
                    long r = 0, g = 0, b = 0;
                    foreach (var c in buckets[i]) { r += c.r; g += c.g; b += c.b; }
                    int n = buckets[i].Count;
                    palette[i] = new Color32((byte)(r / n), (byte)(g / n), (byte)(b / n), 255);
                }
                else palette[i] = new Color32(0, 0, 0, 255);
            }

            // Build per-frame indexed buffers, with a per-batch RGB→index cache.
            indexed = new byte[frames.Length][];
            var cache = new Dictionary<int, byte>(8192);
            for (int f = 0; f < frames.Length; f++)
            {
                var px = frames[f].GetPixels32();
                int w = frames[f].width;
                int h = frames[f].height;
                var idx = new byte[px.Length];
                for (int i = 0; i < px.Length; i++)
                {
                    var c = px[i];
                    int key = (c.r << 16) | (c.g << 8) | c.b;
                    if (!cache.TryGetValue(key, out byte ci))
                    {
                        ci = NearestIndex(c, palette);
                        cache[key] = ci;
                    }
                    idx[i] = ci;
                }
                // Texture2D origin = bottom-left; GIF row 0 = top. Flip rows.
                var flipped = new byte[idx.Length];
                for (int y = 0; y < h; y++)
                    Array.Copy(idx, (h - 1 - y) * w, flipped, y * w, w);
                indexed[f] = flipped;
            }
        }

        static byte NearestIndex(Color32 c, Color32[] palette)
        {
            int bestI = 0;
            int bestDist = int.MaxValue;
            for (int i = 0; i < palette.Length; i++)
            {
                int dr = c.r - palette[i].r;
                int dg = c.g - palette[i].g;
                int db = c.b - palette[i].b;
                int d = dr * dr + dg * dg + db * db;
                if (d < bestDist) { bestDist = d; bestI = i; }
            }
            return (byte)bestI;
        }

        // ── LZW ─────────────────────────────────────────────────────────────

        static void WriteLZW(MemoryStream output, byte[] pixels)
        {
            const int MinCodeSize = 8;
            const int ClearCode = 1 << MinCodeSize;
            const int EndCode = ClearCode + 1;
            const int MaxDictSize = 4096;

            int codeSize = MinCodeSize + 1;
            int nextCode = EndCode + 1;
            var dict = new Dictionary<long, int>();
            var bits = new BitOutput();

            bits.WriteCode(ClearCode, codeSize);

            int prefix = pixels[0];
            for (int i = 1; i < pixels.Length; i++)
            {
                int sym = pixels[i];
                long key = ((long)prefix << 8) | (uint)sym;
                if (dict.TryGetValue(key, out int code))
                {
                    prefix = code;
                }
                else
                {
                    bits.WriteCode(prefix, codeSize);
                    if (nextCode < MaxDictSize)
                    {
                        dict[key] = nextCode;
                        nextCode++;
                        // Off-by-one: encoder must bump codeSize one iter LATER than the
                        // naïve `>= 1<<codeSize` would suggest. Decoder rebuilds the dict one
                        // step behind because its first code adds nothing (prevCode=-1), so
                        // matching its bump point requires `>`. Using `>=` here causes the
                        // encoder to write a 10-bit code while the decoder is still reading 9.
                        if (nextCode > (1 << codeSize) && codeSize < 12)
                            codeSize++;
                    }
                    else
                    {
                        bits.WriteCode(ClearCode, codeSize);
                        dict.Clear();
                        codeSize = MinCodeSize + 1;
                        nextCode = EndCode + 1;
                    }
                    prefix = sym;
                }
            }
            bits.WriteCode(prefix, codeSize);
            bits.WriteCode(EndCode, codeSize);
            bits.Flush();

            var bytes = bits.GetBytes();
            int pos = 0;
            while (pos < bytes.Length)
            {
                int n = Math.Min(255, bytes.Length - pos);
                output.WriteByte((byte)n);
                output.Write(bytes, pos, n);
                pos += n;
            }
            output.WriteByte(0); // sub-block terminator
        }

        sealed class BitOutput
        {
            readonly List<byte> buffer = new List<byte>(4096);
            int currentByte = 0;
            int bitsInByte = 0;

            public void WriteCode(int code, int width)
            {
                for (int i = 0; i < width; i++)
                {
                    int bit = (code >> i) & 1;
                    currentByte |= bit << bitsInByte;
                    bitsInByte++;
                    if (bitsInByte == 8)
                    {
                        buffer.Add((byte)currentByte);
                        currentByte = 0;
                        bitsInByte = 0;
                    }
                }
            }

            public void Flush()
            {
                if (bitsInByte > 0)
                {
                    buffer.Add((byte)currentByte);
                    currentByte = 0;
                    bitsInByte = 0;
                }
            }

            public byte[] GetBytes() => buffer.ToArray();
        }

        static void WriteShort(MemoryStream ms, int v)
        {
            ms.WriteByte((byte)(v & 0xFF));
            ms.WriteByte((byte)((v >> 8) & 0xFF));
        }
    }
}
