#!/usr/bin/env node
/*
 * promo-generator.js — reproducible Chrome Web Store promo tiles.
 * Writes store/promo-tile-440x280.png and store/promo-marquee-1400x560.png.
 * Pure Node (zlib only). Text is drawn from a small built-in 5x7 pixel font.
 *
 *   node store/promo-generator.js
 */
'use strict';
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

// ---- PNG encoder (RGBA) ----
function crc32(buf) { let c = ~0; for (let i = 0; i < buf.length; i++) { c ^= buf[i]; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0); const body = Buffer.concat([Buffer.from(type, 'ascii'), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0); return Buffer.concat([len, body, crc]); }
function encodePng(w, h, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const stride = w * 4; const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (stride + 1)] = 0; rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride); }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// ---- 5x7 pixel font (only the glyphs we need) ----
const FONT = {
  G: ['01110', '10001', '10000', '10111', '10001', '10001', '01110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
};

function drawText(img, w, h, text, x0, y0, scale, rgb) {
  let cx = x0;
  for (const ch of text) {
    const g = FONT[ch] || FONT[' '];
    for (let ry = 0; ry < 7; ry++) {
      for (let rx = 0; rx < 5; rx++) {
        if (g[ry][rx] === '1') {
          for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) {
            const px = cx + rx * scale + sx, py = y0 + ry * scale + sy;
            if (px < 0 || py < 0 || px >= w || py >= h) continue;
            const i = (py * w + px) * 4;
            img[i] = rgb[0]; img[i + 1] = rgb[1]; img[i + 2] = rgb[2]; img[i + 3] = 255;
          }
        }
      }
    }
    cx += (5 + 1) * scale; // 1px letter spacing
  }
  return cx;
}
function textWidth(text, scale) { return text.length * (5 + 1) * scale - scale; }

function lerp(a, b, t) { return a + (b - a) * t; }

function makeTile(W, H) {
  const img = Buffer.alloc(W * H * 4, 0);
  const top = [79, 70, 229], bot = [147, 51, 234];
  for (let y = 0; y < H; y++) {
    const t = y / H;
    const r = lerp(top[0], bot[0], t), g = lerp(top[1], bot[1], t), b = lerp(top[2], bot[2], t);
    for (let x = 0; x < W; x++) {
      // subtle diagonal sheen
      const sheen = 0.06 * Math.sin((x / W + y / H) * Math.PI);
      const i = (y * W + x) * 4;
      img[i] = Math.min(255, Math.round(r + sheen * 255));
      img[i + 1] = Math.min(255, Math.round(g + sheen * 255));
      img[i + 2] = Math.min(255, Math.round(b + sheen * 255));
      img[i + 3] = 255;
    }
  }

  // Lens motif (ring + red target) on the left.
  const cx = Math.round(H * 0.5), cy = Math.round(H * 0.42), R = Math.round(H * 0.22), Ri = Math.round(H * 0.14);
  const dot = [239, 68, 68];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const d = Math.hypot(x - cx, y - cy);
    const i = (y * W + x) * 4;
    if (d <= R && d >= Ri) { const aa = Math.min(1, Math.min(R - d, d - Ri)); img[i] = lerp(img[i], 255, aa); img[i + 1] = lerp(img[i + 1], 255, aa); img[i + 2] = lerp(img[i + 2], 255, aa); }
    if (d <= Ri * 0.5) { const aa = Math.min(1, Ri * 0.5 - d); img[i] = lerp(img[i], dot[0], aa); img[i + 1] = lerp(img[i + 1], dot[1], aa); img[i + 2] = lerp(img[i + 2], dot[2], aa); }
    // handle
    const hx = x - (cx + R * 0.72), hy = y - (cy + R * 0.72);
    const along = (hx + hy) / Math.SQRT2, across = (hx - hy) / Math.SQRT2;
    if (along > 0 && along < R * 0.7 && Math.abs(across) < R * 0.14) { img[i] = lerp(img[i], 255, 0.9); img[i + 1] = lerp(img[i + 1], 255, 0.9); img[i + 2] = lerp(img[i + 2], 255, 0.9); }
  }

  // Five category dots under the lens.
  const cats = [[239, 68, 68], [249, 115, 22], [234, 179, 8], [59, 130, 246], [168, 85, 247]];
  const dr = Math.round(H * 0.028), gap = dr * 3;
  const startX = cx - gap * 2, dy = cy + R + Math.round(H * 0.14);
  cats.forEach((c, k) => {
    const px0 = startX + k * gap;
    for (let y = -dr; y <= dr; y++) for (let x = -dr; x <= dr; x++) {
      if (x * x + y * y > dr * dr) continue;
      const X = px0 + x, Y = dy + y; if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
      const i = (Y * W + X) * 4; img[i] = c[0]; img[i + 1] = c[1]; img[i + 2] = c[2]; img[i + 3] = 255;
    }
  });

  // Wordmark "GEO LENS" on the right.
  const scale = Math.max(3, Math.round(H / 40));
  const word = 'GEO LENS';
  const tw = textWidth(word, scale);
  const textX = Math.round(cx + R + H * 0.12);
  const availW = W - textX - Math.round(H * 0.08);
  const fitScale = tw > availW ? Math.max(2, Math.floor(scale * availW / tw)) : scale;
  const finalW = textWidth(word, fitScale);
  drawText(img, W, H, word, textX, Math.round(H * 0.30), fitScale, [255, 255, 255]);

  // Tagline "AEO GEO AUDITOR" would need more glyphs; keep a colored underline bar instead.
  const barY = Math.round(H * 0.30) + 7 * fitScale + Math.round(H * 0.05);
  const barW = Math.min(finalW, availW);
  for (let x = 0; x < barW; x++) {
    const c = cats[Math.floor((x / barW) * 5) % 5];
    for (let y = 0; y < Math.max(3, Math.round(H * 0.012)); y++) {
      const X = textX + x, Y = barY + y; if (X >= W || Y >= H) continue;
      const i = (Y * W + X) * 4; img[i] = c[0]; img[i + 1] = c[1]; img[i + 2] = c[2]; img[i + 3] = 255;
    }
  }

  return encodePng(W, H, img);
}

const out = __dirname;
fs.writeFileSync(path.join(out, 'promo-tile-440x280.png'), makeTile(440, 280));
fs.writeFileSync(path.join(out, 'promo-marquee-1400x560.png'), makeTile(1400, 560));
console.log('wrote promo-tile-440x280.png and promo-marquee-1400x560.png');
