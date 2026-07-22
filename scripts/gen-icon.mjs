// Generates src-tauri/app-icon.png (1024x1024) procedurally — no image deps.
// Minimal PNG encoder: signature + IHDR + IDAT(zlib) + IEND with CRC32.
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "src-tauri", "app-icon.png");

const S = 1024;
const px = new Uint8Array(S * S * 4); // RGBA

function put(x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= S || y >= S) return;
  const i = (y * S + x) * 4;
  // simple source-over blend
  const sa = a / 255;
  px[i] = Math.round(r * sa + px[i] * (1 - sa));
  px[i + 1] = Math.round(g * sa + px[i + 1] * (1 - sa));
  px[i + 2] = Math.round(b * sa + px[i + 2] * (1 - sa));
  px[i + 3] = Math.max(px[i + 3], a);
}

// macOS-style squircle-ish rounded rect mask
function inRounded(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = x < x0 + r ? x0 + r : x > x1 - r ? x1 - r : x;
  const cy = y < y0 + r ? y0 + r : y > y1 - r ? y1 - r : y;
  const dx = x - cx, dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

// Background: rounded red→crimson vertical gradient (with macOS margin)
const M = 100; // transparent margin like real macOS icons
const R = 185;
for (let y = 0; y < S; y++) {
  const t = y / S;
  const r = Math.round(229 - 40 * t); // #E5484D → darker
  const g = Math.round(72 - 22 * t);
  const b = Math.round(77 - 14 * t);
  for (let x = 0; x < S; x++) {
    if (inRounded(x, y, M, M, S - M, S - M, R)) put(x, y, r, g, b, 255);
  }
}

// White document sheet (centered, portrait) with folded corner
const dx0 = 322, dy0 = 250, dx1 = 702, dy1 = 774, fold = 110, dr = 26;
for (let y = dy0; y <= dy1; y++) {
  for (let x = dx0; x <= dx1; x++) {
    if (!inRounded(x, y, dx0, dy0, dx1, dy1, dr)) continue;
    // cut the top-right fold triangle
    if (x - (dx1 - fold) > 0 && (dy0 + fold) - y > 0 && x - (dx1 - fold) > y - dy0) continue;
    put(x, y, 255, 255, 255, 255);
  }
}
// Fold flap (slightly grey triangle)
for (let y = dy0; y <= dy0 + fold; y++) {
  for (let x = dx1 - fold; x <= dx1; x++) {
    const lx = x - (dx1 - fold), ly = y - dy0;
    if (lx >= 0 && ly >= 0 && lx + ly <= fold && lx >= ly) put(x, y, 226, 228, 232, 255);
  }
}

// Red "text" bars on the sheet
function bar(x0, y0, w, h, r, g, b) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) put(x, y, r, g, b, 255);
}
bar(372, 420, 200, 34, 229, 72, 77); // heading
bar(372, 500, 280, 22, 203, 213, 225);
bar(372, 552, 280, 22, 203, 213, 225);
bar(372, 604, 220, 22, 203, 213, 225);
bar(372, 680, 150, 30, 229, 72, 77); // accent

// PNG encode
function crc32(buf) {
  let c, table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0);
ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // 8-bit RGBA
const raw = Buffer.alloc(S * (S * 4 + 1));
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0; // filter: none
  px.subarray(y * S * 4, (y + 1) * S * 4).forEach((v, i) => (raw[y * (S * 4 + 1) + 1 + i] = v));
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, png);
console.log("wrote", out, png.length, "bytes");
