// Material You palette generation -- the same library matugen is built on
// (material-color-utilities), so a wallpaper gives the colours it would on Linux.

import {
  Hct, QuantizerCelebi, Score, argbFromHex, hexFromArgb, argbFromRgb,
  SchemeTonalSpot, SchemeVibrant, SchemeExpressive, SchemeFidelity,
  SchemeContent, SchemeNeutral, SchemeMonochrome, SchemeRainbow, SchemeFruitSalad,
} from './vendor/mcu.js';

export const STYLES = {
  tonal_spot: { label: 'Tonal spot (matugen default)', Scheme: SchemeTonalSpot },
  vibrant: { label: 'Vibrant', Scheme: SchemeVibrant },
  expressive: { label: 'Expressive', Scheme: SchemeExpressive },
  fidelity: { label: 'Fidelity', Scheme: SchemeFidelity },
  content: { label: 'Content', Scheme: SchemeContent },
  rainbow: { label: 'Rainbow', Scheme: SchemeRainbow },
  fruit_salad: { label: 'Fruit salad', Scheme: SchemeFruitSalad },
  neutral: { label: 'Neutral', Scheme: SchemeNeutral },
  monochrome: { label: 'Monochrome', Scheme: SchemeMonochrome },
  exact: { label: 'Exact colour (no softening)', Scheme: SchemeFidelity },
};

// Decode an image (data URL or any fetchable URL) into ARGB pixels. Works in the
// service worker too, which has no DOM: createImageBitmap + OffscreenCanvas.
async function imagePixels(src, size = 128) {
  const blob = await (await fetch(src)).blob();
  const bmp = await createImageBitmap(blob);
  const scale = Math.min(1, size / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bmp, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  const pixels = [];
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 255) continue;
    pixels.push(argbFromRgb(data[i], data[i + 1], data[i + 2]));
  }
  return pixels;
}

// The wallpaper's candidate seed colours, best first (what matugen picks from).
export async function extractSeeds(src, count = 5) {
  const pixels = await imagePixels(src);
  const quantized = QuantizerCelebi.quantize(pixels, 128);
  let seeds = Score.score(quantized, { desired: count, filter: true });
  // Near-greyscale images leave the filtered list with just the fallback blue;
  // take the dominant colours unfiltered instead so the page still matches.
  if (seeds.length === 1 && seeds[0] === 0xff4285f4) {
    seeds = Score.score(quantized, { desired: count, filter: false });
  }
  return seeds.map(hexFromArgb);
}

function chroma(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return Math.max(r, g, b) - Math.min(r, g, b);
}

function readableOn(hex) {
  const n = parseInt(hex.slice(1), 16);
  const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return L > 0.36 ? '#111111' : '#ffffff';
}

// Seed colour -> the same named roles the Linux matugen template produced.
export function buildPalette(seedHex, style = 'vibrant', dark = true) {
  const def = STYLES[style] || STYLES.vibrant;
  const s = new def.Scheme(Hct.fromInt(argbFromHex(seedHex)), dark, 0);
  const c = {
    background: hexFromArgb(s.background),
    surface: hexFromArgb(s.surface),
    surface_variant: hexFromArgb(s.surfaceVariant),
    on_surface: hexFromArgb(s.onSurface),
    on_surface_variant: hexFromArgb(s.onSurfaceVariant),
    outline_variant: hexFromArgb(s.outlineVariant),
    primary: hexFromArgb(s.primary),
    on_primary: hexFromArgb(s.onPrimary),
  };
  if (style === 'exact') {
    c.primary = seedHex.toLowerCase();
    c.on_primary = readableOn(seedHex);
  }
  // A near-monochrome wallpaper can collapse primary to an almost colourless
  // near-white; fall back to a real grey so the accent digits stay visible.
  c.accent = chroma(c.primary) < 20 ? c.on_surface_variant : c.primary;
  c.seed = seedHex.toLowerCase();
  c.dark = dark;
  return c;
}
