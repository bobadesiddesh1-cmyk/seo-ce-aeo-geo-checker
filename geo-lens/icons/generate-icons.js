#!/usr/bin/env node
/*
 * generate-icons.js — reproducible icon generator for GEO Lens.
 *
 * Draws a lens ring over a target dot on a rounded brand-gradient tile and
 * writes 16/32/48/128 PNGs. Pure Node (zlib only), no dependencies, no build.
 *
 *   node icons/generate-icons.js
 *
 * The PNGs are committed to the repo so the extension loads without running
 * this; re-run it to regenerate them.
 */
'use strict';

const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

// ---- tiny PNG encoder (RGBA, 8-bit) ---------------------------------------
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  // filtered raw data: one filter byte (0) per scanline
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- drawing --------------------------------------------------------------
function lerp(a, b, t) { return a + (b - a) * t; }

function draw(size) {
  const rgba = Buffer.alloc(size * size * 4, 0);
  const cx = size / 2;
  const cy = size / 2;
  const radius = size * 0.5;
  const corner = size * 0.22; // rounded tile

  // brand gradient endpoints (indigo -> violet)
  const top = [79, 70, 229];    // #4F46E5
  const bot = [147, 51, 234];   // #9333EA
  const ring = [255, 255, 255];
  const dot = [239, 68, 68];    // red target dot (#EF4444)

  const ringOuter = size * 0.34;
  const ringInner = size * 0.22;
  const dotR = size * 0.10;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;

      // rounded-square mask
      const ax = Math.abs(dx) - (radius - corner);
      const ay = Math.abs(dy) - (radius - corner);
      const outside =
        Math.max(ax, 0) ** 2 + Math.max(ay, 0) ** 2 > corner * corner ||
        Math.abs(dx) > radius ||
        Math.abs(dy) > radius;
      if (outside) continue;

      // background gradient
      const t = y / size;
      let r = lerp(top[0], bot[0], t);
      let g = lerp(top[1], bot[1], t);
      let b = lerp(top[2], bot[2], t);
      let a = 255;

      const dist = Math.hypot(dx, dy);

      // lens ring (annulus), slightly off-center up-left like a magnifier
      const lx = dx + size * 0.06;
      const ly = dy + size * 0.06;
      const ldist = Math.hypot(lx, ly);
      if (ldist <= ringOuter && ldist >= ringInner) {
        const edge = Math.min(ringOuter - ldist, ldist - ringInner);
        const aa = Math.min(1, edge);
        r = lerp(r, ring[0], aa);
        g = lerp(g, ring[1], aa);
        b = lerp(b, ring[2], aa);
      }

      // handle of the magnifier (lower-right diagonal bar)
      const hx = dx - size * 0.20;
      const hy = dy - size * 0.20;
      const along = (hx + hy) / Math.SQRT2;
      const across = (hx - hy) / Math.SQRT2;
      if (along > 0 && along < size * 0.20 && Math.abs(across) < size * 0.055) {
        r = lerp(r, ring[0], 0.95);
        g = lerp(g, ring[1], 0.95);
        b = lerp(b, ring[2], 0.95);
      }

      // target dot in the lens center
      if (ldist <= dotR) {
        const aa = Math.min(1, dotR - ldist);
        r = lerp(r, dot[0], aa);
        g = lerp(g, dot[1], aa);
        b = lerp(b, dot[2], aa);
      }

      rgba[i] = Math.round(r);
      rgba[i + 1] = Math.round(g);
      rgba[i + 2] = Math.round(b);
      rgba[i + 3] = a;
    }
  }
  return encodePng(size, size, rgba);
}

const outDir = __dirname;
for (const size of [16, 32, 48, 128]) {
  const png = draw(size);
  fs.writeFileSync(path.join(outDir, `icon${size}.png`), png);
  console.log(`wrote icon${size}.png (${png.length} bytes)`);
}
