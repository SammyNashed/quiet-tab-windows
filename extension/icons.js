// Shortcut icons: the bundled Simple Icons library (3,400+ brand glyphs, CC0),
// and the styles that draw them. A site's own icon is only a fallback for
// sites the library has no logo for.

export const ICON_STYLES = [
  { id: 'ios', label: 'iOS 26 dark', hint: 'Dark glass tiles, logos in colour' },
  { id: 'brand', label: 'Brand colour', hint: 'Logo on its brand colour' },
  { id: 'themed', label: 'Themed', hint: 'Tinted to match your colours' },
  { id: 'accent', label: 'Accent', hint: 'Solid tiles in your accent' },
  { id: 'mono', label: 'Monochrome', hint: 'Quiet and grey' },
  { id: 'glyph', label: 'Logo only', hint: 'No tiles, just the logos' },
];

// ------------------------------------------------------------------ library

let libraryPromise = null;

export function loadLibrary() {
  if (!libraryPromise) {
    libraryPromise = fetch(chrome.runtime.getURL('icons/library.json'))
      .then((r) => r.json())
      .then((data) => {
        const bySlug = new Map();
        for (const entry of data.icons) bySlug.set(entry[0], entry);
        return { icons: data.icons, bySlug, source: data.source };
      });
  }
  return libraryPromise;
}

// Sites whose domain doesn't spell their icon's name.
const DOMAIN_MAP = {
  'mail.google.com': 'gmail',
  'x.com': 'x',
  'twitter.com': 'x',
  'web.telegram.org': 'telegram',
  't.me': 'telegram',
  'youtu.be': 'youtube',
  'news.ycombinator.com': 'ycombinator',
  'play.max.com': 'max',
  'open.spotify.com': 'spotify',
  'music.apple.com': 'applemusic',
};
const IGNORED_LABELS = new Set(['www', 'm', 'web', 'app', 'en', 'my', 'home', 'login', 'accounts']);

// Best icon slug for a URL, or null.
export function matchSlug(url, lib) {
  let host;
  try { host = new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch (e) { return null; }
  if (DOMAIN_MAP[host] && lib.bySlug.has(DOMAIN_MAP[host])) return DOMAIN_MAP[host];

  const labels = host.split('.');
  // "bbc.co.uk" -> sld "bbc"; "github.com" -> "github"
  let sldIndex = labels.length - 2;
  if (labels.length >= 3 && labels[labels.length - 1].length === 2 &&
      ['co', 'com', 'net', 'org', 'gov', 'ac', 'edu'].includes(labels[labels.length - 2])) sldIndex--;
  const sld = labels[Math.max(0, sldIndex)];
  const subs = labels.slice(0, Math.max(0, sldIndex)).filter((l) => !IGNORED_LABELS.has(l));

  const tries = [
    ...subs.map((s) => sld + s),                 // drive.google.com -> googledrive
    ...subs.map((s) => s + sld),                 // music.youtube.com -> youtubemusic? (tries both orders)
    host.replace(/\./g, 'dot'),                  // dev.to -> devdotto
    sld,
    labels.slice(0, sldIndex + 1).join(''),
    ...subs,
  ];
  for (const t of tries) {
    const slug = t.replace(/[^a-z0-9]/g, '');
    if (slug && lib.bySlug.has(slug)) return slug;
  }
  return null;
}

export function searchLibrary(lib, query, limit = 48) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const starts = [], contains = [];
  for (const e of lib.icons) {
    const t = e[1].toLowerCase();
    if (t.startsWith(q) || e[0].startsWith(q)) starts.push(e);
    else if (t.includes(q)) contains.push(e);
    if (starts.length >= limit) break;
  }
  return starts.concat(contains).slice(0, limit);
}

// ------------------------------------------------------------------ site icons

// Hand-picked high-res icons for sites where the live fetch chain falls short.
const CURATED_ICONS = {
  whatsapp: 'icons/apps/whatsapp.png',
  youtube: 'icons/apps/youtube.png',
};

function curatedIcon(pageUrl) {
  const host = new URL(pageUrl).hostname;
  for (const [keyword, path] of Object.entries(CURATED_ICONS)) {
    if (host.includes(keyword)) return chrome.runtime.getURL(path);
  }
  return null;
}

// The icons a site declares in its own page, best first: apple-touch-icon (the
// square "app icon"), then the largest other icon it lists.
async function declaredIcons(origin) {
  try {
    const res = await fetch(origin + '/', { credentials: 'omit' });
    if (!res.ok || !(res.headers.get('content-type') || '').includes('html')) return [];
    const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
    const found = [];
    for (const link of doc.querySelectorAll('link[rel][href]')) {
      const rel = link.getAttribute('rel').toLowerCase();
      if (!/\bicon\b|apple-touch-icon/.test(rel)) continue;
      const size = Math.max(0, ...(link.getAttribute('sizes') || '').split(/\s+/).map((v) => parseInt(v, 10) || 0));
      const svg = /\.svg(\?|$)/i.test(link.getAttribute('href')) || link.getAttribute('type') === 'image/svg+xml';
      const score = (rel.includes('apple-touch-icon') ? 10000 : 0) + (svg ? 5000 : 0) + (size || 32);
      try { found.push({ url: new URL(link.getAttribute('href'), res.url).href, score }); } catch (e) { /* bad href */ }
    }
    return found.sort((a, b) => b.score - a.score).map((f) => f.url);
  } catch (e) {
    return [];
  }
}

async function siteIconCandidates(pageUrl) {
  const origin = new URL(pageUrl).origin;
  const guessed = [`${origin}/apple-touch-icon.png`, `${origin}/apple-touch-icon-precomposed.png`, `${origin}/favicon.ico`];
  const declared = await declaredIcons(origin);
  return [...declared, ...guessed.filter((u) => !declared.includes(u))];
}

// Favicons often come with no-cache headers; resolve each once and keep it as a
// data URL so a new tab never waits on the network.
const ICON_CACHE_KEY = 'iconCache2'; // v2: prefers the icons a page declares
const ICON_CACHE_TTL = 1000 * 60 * 60 * 24 * 30;
let siteCache = null;
const inFlight = new Map();

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export function siteIcon(pageUrl) {
  const curated = curatedIcon(pageUrl);
  if (curated) return Promise.resolve(curated);
  const host = new URL(pageUrl).hostname;
  // The dock and the style previews ask for the same icons at once.
  if (!inFlight.has(host)) inFlight.set(host, resolveSiteIcon(pageUrl, host).finally(() => inFlight.delete(host)));
  return inFlight.get(host);
}

async function resolveSiteIcon(pageUrl, host) {
  if (!siteCache) siteCache = (await chrome.storage.local.get(ICON_CACHE_KEY))[ICON_CACHE_KEY] || {};
  const cached = siteCache[host];
  if (cached && Date.now() - cached.ts < ICON_CACHE_TTL) return cached.dataUrl;

  for (const url of await siteIconCandidates(pageUrl)) {
    try {
      const res = await fetch(url, { credentials: 'omit' });
      if (!res.ok) continue;
      const blob = await res.blob();
      if (!blob.size || !blob.type.startsWith('image')) continue; // some sites answer with a web page
      const dataUrl = await blobToDataUrl(blob);
      siteCache[host] = { dataUrl, ts: Date.now() };
      chrome.storage.local.set({ [ICON_CACHE_KEY]: siteCache });
      chrome.storage.local.remove('iconCache');
      return dataUrl;
    } catch (e) { /* try the next one */ }
  }
  return null;
}

// ------------------------------------------------------------------ drawing

function luminance(hex) {
  const n = parseInt(hex, 16);
  const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

let gradientId = 0;

// `fill` is either nothing (inherit currentColor) or [top, bottom] colours for a
// soft top-lit gradient, the way iOS 26 renders logos.
function glyphSvg(path, fill) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', path);
  if (fill) {
    const id = 'qtg' + (++gradientId);
    const grad = document.createElementNS(ns, 'linearGradient');
    grad.setAttribute('id', id);
    grad.setAttribute('x1', '0'); grad.setAttribute('y1', '0');
    grad.setAttribute('x2', '0'); grad.setAttribute('y2', '1');
    fill.forEach((color, i) => {
      const stop = document.createElementNS(ns, 'stop');
      stop.setAttribute('offset', String(i));
      stop.setAttribute('stop-color', color);
      grad.appendChild(stop);
    });
    const defs = document.createElementNS(ns, 'defs');
    defs.appendChild(grad);
    svg.appendChild(defs);
    p.setAttribute('fill', `url(#${id})`);
  }
  svg.appendChild(p);
  return svg;
}

function mixWithWhite(hex, amount) {
  const n = parseInt(hex, 16);
  const ch = (v) => Math.round(v + (255 - v) * amount).toString(16).padStart(2, '0');
  return '#' + ch((n >> 16) & 255) + ch((n >> 8) & 255) + ch(n & 255);
}

// iOS 26 dark mode: the logo in its own colour on a dark glass tile. Logos too
// dark to read there (GitHub, X, Wikipedia...) turn light, as iOS does.
function drawIos(tile, link, glyph, letter) {
  const curated = curatedIcon(link.url);
  if (curated && (!glyph || ['whatsapp', 'youtube'].includes(glyph[0]))) {
    const img = document.createElement('img');
    img.alt = '';
    img.className = 'ios-art';
    img.src = curated;
    tile.appendChild(img);
    return;
  }
  if (glyph) {
    let hex = glyph[2];
    if (luminance(hex) < 0.06) hex = 'f2f2f7';
    tile.appendChild(glyphSvg(glyph[3], [mixWithWhite(hex, 0.28), '#' + hex]));
    return;
  }
  // No library logo: the site's own icon, inset on the same dark tile.
  const l = letter();
  tile.dataset.loading = '1';
  siteIcon(link.url).then((src) => {
    if (!src) { delete tile.dataset.loading; return; }
    const img = document.createElement('img');
    img.alt = '';
    img.className = 'ios-inset';
    img.onload = () => { l.remove(); tile.appendChild(img); delete tile.dataset.loading; };
    img.onerror = () => { delete tile.dataset.loading; };
    img.src = src;
  });
}

// Draw one shortcut's icon into `tile` (which is sized and rounded by CSS).
// link.glyph is [slug, title, hex, path] when a library icon applies, else null.
export function drawIcon(tile, link, style) {
  tile.className = 'tile style-' + style;
  tile.textContent = '';
  const glyph = link.glyph;

  const letter = () => {
    const span = document.createElement('span');
    span.className = 'tile-letter';
    span.textContent = (link.name || '?').trim().charAt(0) || '?';
    tile.appendChild(span);
    return span;
  };

  const site = () => {
    tile.classList.add('is-site');
    // While the site's icon loads, or if it can't be fetched, show its bundled
    // logo on its brand colour rather than a bare letter.
    let placeholder;
    if (glyph) {
      tile.classList.add('style-brand');
      tile.style.setProperty('--brand', '#' + glyph[2]);
      tile.style.setProperty('--brand-fg', luminance(glyph[2]) > 0.55 ? '#111' : '#fff');
      placeholder = glyphSvg(glyph[3]);
      tile.appendChild(placeholder);
    } else {
      placeholder = letter();
    }
    tile.dataset.loading = '1';
    siteIcon(link.url).then((src) => {
      if (!src) { delete tile.dataset.loading; return; }
      const img = document.createElement('img');
      img.alt = '';
      img.onload = () => {
        placeholder.remove();
        tile.classList.remove('style-brand');
        tile.classList.add('has-img');
        tile.appendChild(img);
        delete tile.dataset.loading;
      };
      img.onerror = () => { delete tile.dataset.loading; };
      img.src = src;
    });
  };

  if (style === 'ios') { drawIos(tile, link, glyph, letter); return; }
  if (!glyph && style === 'brand') { site(); return; }

  if (glyph) {
    const hex = glyph[2];
    const lum = luminance(hex);
    tile.style.setProperty('--brand', '#' + hex);
    tile.style.setProperty('--brand-fg', lum > 0.55 ? '#111' : '#fff');
    // Logos in their own colour vanish on a background of similar lightness.
    if (lum < 0.035) tile.classList.add('brand-dark');
    if (lum > 0.8) tile.classList.add('brand-light');
    tile.appendChild(glyphSvg(glyph[3]));
  } else {
    letter();
  }
}
