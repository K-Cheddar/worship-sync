/**
 * Generates `public/maskable-icon-512.png` from `public/logo512.png`.
 *
 * Android crops maskable icons to a platform-chosen shape (circle, squircle,
 * teardrop). Only the inner 80% diameter is guaranteed visible, so the source
 * logo — which is edge-to-edge with a transparent background — must be scaled
 * down onto an opaque background or its corners get clipped.
 *
 * Uses only Node built-ins (zlib) so icon generation needs no native image
 * dependency. Run with: node scripts/generate-maskable-icon.mjs
 */

import { readFileSync, writeFileSync } from "node:fs";
import { deflateSync, inflateSync } from "node:zlib";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SOURCE = resolve(here, "../public/logo512.png");
const OUTPUT = resolve(here, "../public/maskable-icon-512.png");

const SIZE = 512;
/** Fraction of the canvas the logo occupies; keeps it inside the 80% safe zone. */
const LOGO_SCALE = 0.6;
/** Matches `--color-homepage-canvas` / the manifest `background_color`. */
const BACKGROUND = [0x2b, 0x35, 0x44];

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const readChunks = (buffer) => {
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error("Source is not a PNG");
  }
  const chunks = [];
  let offset = 8;
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    chunks.push({ type, data });
    offset += 12 + length;
  }
  return chunks;
};

const paeth = (a, b, c) => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
};

/** Reverses the per-scanline PNG filters, returning raw RGBA bytes. */
const unfilter = (raw, width, height, bytesPerPixel) => {
  const stride = width * bytesPerPixel;
  const out = Buffer.alloc(height * stride);
  let pos = 0;

  for (let y = 0; y < height; y += 1) {
    const filter = raw[pos];
    pos += 1;
    const line = raw.subarray(pos, pos + stride);
    pos += stride;
    const rowStart = y * stride;
    const prevStart = (y - 1) * stride;

    for (let x = 0; x < stride; x += 1) {
      const rawByte = line[x];
      const left = x >= bytesPerPixel ? out[rowStart + x - bytesPerPixel] : 0;
      const up = y > 0 ? out[prevStart + x] : 0;
      const upLeft =
        y > 0 && x >= bytesPerPixel ? out[prevStart + x - bytesPerPixel] : 0;

      let value;
      switch (filter) {
        case 0:
          value = rawByte;
          break;
        case 1:
          value = rawByte + left;
          break;
        case 2:
          value = rawByte + up;
          break;
        case 3:
          value = rawByte + ((left + up) >> 1);
          break;
        case 4:
          value = rawByte + paeth(left, up, upLeft);
          break;
        default:
          throw new Error(`Unsupported PNG filter ${filter}`);
      }
      out[rowStart + x] = value & 0xff;
    }
  }
  return out;
};

const decodePng = (buffer) => {
  const chunks = readChunks(buffer);
  const ihdr = chunks.find((c) => c.type === "IHDR");
  if (!ihdr) throw new Error("PNG missing IHDR");

  const width = ihdr.data.readUInt32BE(0);
  const height = ihdr.data.readUInt32BE(4);
  const bitDepth = ihdr.data[8];
  const colorType = ihdr.data[9];
  const interlace = ihdr.data[12];

  if (bitDepth !== 8) throw new Error(`Unsupported bit depth ${bitDepth}`);
  if (interlace !== 0) throw new Error("Interlaced PNGs are not supported");
  if (colorType !== 6 && colorType !== 2) {
    throw new Error(`Unsupported color type ${colorType}`);
  }

  const bytesPerPixel = colorType === 6 ? 4 : 3;
  const idat = Buffer.concat(
    chunks.filter((c) => c.type === "IDAT").map((c) => c.data),
  );
  const pixels = unfilter(inflateSync(idat), width, height, bytesPerPixel);

  // Normalize RGB sources to RGBA so compositing has one code path.
  if (bytesPerPixel === 3) {
    const rgba = Buffer.alloc(width * height * 4, 0xff);
    for (let i = 0; i < width * height; i += 1) {
      rgba[i * 4] = pixels[i * 3];
      rgba[i * 4 + 1] = pixels[i * 3 + 1];
      rgba[i * 4 + 2] = pixels[i * 3 + 2];
    }
    return { width, height, pixels: rgba };
  }

  return { width, height, pixels };
};

const crcTable = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

const crc32 = (buf) => {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
};

const chunk = (type, data) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
};

const encodePng = (width, height, rgba) => {
  const stride = width * 4;
  // Filter type 0 (None) per scanline: deflate handles the flat-color areas well.
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  return Buffer.concat([
    PNG_SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
};

/** Box-filter downscale: averages every source pixel that maps into a target pixel. */
const resize = (src, srcWidth, srcHeight, dstWidth, dstHeight) => {
  const out = Buffer.alloc(dstWidth * dstHeight * 4);
  const xRatio = srcWidth / dstWidth;
  const yRatio = srcHeight / dstHeight;

  for (let y = 0; y < dstHeight; y += 1) {
    const y0 = Math.floor(y * yRatio);
    const y1 = Math.min(srcHeight, Math.ceil((y + 1) * yRatio));
    for (let x = 0; x < dstWidth; x += 1) {
      const x0 = Math.floor(x * xRatio);
      const x1 = Math.min(srcWidth, Math.ceil((x + 1) * xRatio));

      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let count = 0;
      for (let sy = y0; sy < y1; sy += 1) {
        for (let sx = x0; sx < x1; sx += 1) {
          const i = (sy * srcWidth + sx) * 4;
          const alpha = src[i + 3];
          // Weight color by alpha so transparent edges don't darken the result.
          r += src[i] * alpha;
          g += src[i + 1] * alpha;
          b += src[i + 2] * alpha;
          a += alpha;
          count += 1;
        }
      }

      const o = (y * dstWidth + x) * 4;
      if (a > 0) {
        out[o] = Math.round(r / a);
        out[o + 1] = Math.round(g / a);
        out[o + 2] = Math.round(b / a);
        out[o + 3] = Math.round(a / count);
      }
    }
  }
  return out;
};

const source = decodePng(readFileSync(SOURCE));

const logoSize = Math.round(SIZE * LOGO_SCALE);
const logo = resize(
  source.pixels,
  source.width,
  source.height,
  logoSize,
  logoSize,
);

// Opaque canvas: maskable icons must fill the whole square, no transparency.
const canvas = Buffer.alloc(SIZE * SIZE * 4);
for (let i = 0; i < SIZE * SIZE; i += 1) {
  canvas[i * 4] = BACKGROUND[0];
  canvas[i * 4 + 1] = BACKGROUND[1];
  canvas[i * 4 + 2] = BACKGROUND[2];
  canvas[i * 4 + 3] = 0xff;
}

const offset = Math.round((SIZE - logoSize) / 2);
for (let y = 0; y < logoSize; y += 1) {
  for (let x = 0; x < logoSize; x += 1) {
    const s = (y * logoSize + x) * 4;
    const alpha = logo[s + 3] / 255;
    if (alpha === 0) continue;
    const d = ((y + offset) * SIZE + (x + offset)) * 4;
    for (let c = 0; c < 3; c += 1) {
      canvas[d + c] = Math.round(logo[s + c] * alpha + canvas[d + c] * (1 - alpha));
    }
  }
}

writeFileSync(OUTPUT, encodePng(SIZE, SIZE, canvas));
console.log(`Wrote ${OUTPUT} (${logoSize}px logo on ${SIZE}px canvas)`);
