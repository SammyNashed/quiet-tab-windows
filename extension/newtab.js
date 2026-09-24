import { STYLES, extractSeeds } from './palette.js';
import { DEFAULT_SETTINGS } from './defaults.js';

const dock = document.getElementById('dock');
const clockH = document.getElementById('clockH');
const clockM = document.getElementById('clockM');
const clockS = document.getElementById('clockS');
const clockDate = document.getElementById('clockDate');
const addPanel = document.getElementById('addPanel');
const addName = document.getElementById('addName');
const addUrl = document.getElementById('addUrl');

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function ordinal(n) {
  if (n % 10 === 1 && n % 100 !== 11) return n + 'st';
  if (n % 10 === 2 && n % 100 !== 12) return n + 'nd';
  if (n % 10 === 3 && n % 100 !== 13) return n + 'rd';
  return n + 'th';
}

// Hand-picked high-res icons for sites where the live fetch chain below
// falls short (wrong style, or the site just doesn't serve a good one at a
// guessable path). Add more here as needed: drop a PNG in icons/apps/ and
// add a matching hostname keyword.
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

function iconCandidates(pageUrl) {
  const curated = curatedIcon(pageUrl);
  if (curated) return [curated];

  // High-res icons straight from the site itself, no third party involved.
  // apple-touch-icon is the closest thing to a standard "app icon" format:
  // square, high-res, deliberately designed -- exactly the iOS look asked for.
  const origin = new URL(pageUrl).origin;
  return [
    `${origin}/apple-touch-icon.png`,
    `${origin}/apple-touch-icon-precomposed.png`,
    `${origin}/favicon.ico`,
  ];
}

// Many sites send no-cache/short-lived headers on favicons, so leaving this
// to the browser's own HTTP cache means a fresh network fetch (and a visible
// icon pop-in) on every single new tab. Resolve the icon once, store it as a
// data URL in extension storage, and skip the network entirely after that.
const ICON_CACHE_TTL = 1000 * 60 * 60 * 24 * 30; // 30 days

async function getIconCache() {
  const { iconCache } = await chrome.storage.local.get('iconCache');
  return iconCache || {};
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function resolveIconDataUrl(candidates) {
  for (const url of candidates) {
    if (url.startsWith('chrome-extension://')) return url; // bundled asset, not fetched
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const blob = await res.blob();
      if (!blob.size) continue;
      return await blobToDataUrl(blob);
    } catch (e) {
      continue;
    }
  }
  return null;
}

async function loadBestIcon(img, letter, pageUrl) {
  const host = new URL(pageUrl).hostname;
  const cache = await getIconCache();
  const cached = cache[host];

  if (cached && Date.now() - cached.ts < ICON_CACHE_TTL) {
    img.onerror = () => img.remove();
    img.onload = () => letter.remove();
    img.src = cached.dataUrl;
    return;
  }

  const dataUrl = await resolveIconDataUrl(iconCandidates(pageUrl));
  if (!dataUrl) {
    img.remove();
    return;
  }
  img.onerror = () => img.remove();
  img.onload = () => letter.remove();
  img.src = dataUrl;

  cache[host] = { dataUrl, ts: Date.now() };
  await chrome.storage.local.set({ iconCache: cache });
}

let lastDate = null;

function tickClock() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  clockH.textContent = pad(now.getHours());
  clockM.textContent = pad(now.getMinutes());
  clockS.textContent = pad(now.getSeconds());

  const dayKey = now.toDateString();
  if (dayKey !== lastDate) {
    lastDate = dayKey;
    clockDate.innerHTML = `${DAY_NAMES[now.getDay()]} <span class="accent">${ordinal(now.getDate())} ${MONTH_NAMES[now.getMonth()]}</span>`;
  }
}

function normalizeUrl(raw) {
  const trimmed = raw.trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed;
  return 'https://' + trimmed;
}

async function getLinks() {
  const { links } = await chrome.storage.local.get('links');
  return links || [];
}

async function saveLinks(links) {
  await chrome.storage.local.set({ links });
}

function makeDockItem(link, index) {
  const a = document.createElement('a');
  a.className = 'dock-item';
  a.href = link.url;
  a.dataset.name = link.name;

  const letter = document.createElement('div');
  letter.className = 'letter';
  letter.textContent = link.name.trim().charAt(0) || '?';
  a.appendChild(letter);

  const icon = document.createElement('img');
  icon.alt = '';
  a.appendChild(icon);
  loadBestIcon(icon, letter, link.url);

  const remove = document.createElement('button');
  remove.className = 'remove';
  remove.textContent = '×';
  remove.title = 'Remove';
  remove.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const links = await getLinks();
    links.splice(index, 1);
    await saveLinks(links);
    render();
  });
  a.appendChild(remove);

  return a;
}

function makeAddItem() {
  const div = document.createElement('div');
  div.className = 'dock-item add';
  const plus = document.createElement('div');
  plus.className = 'plus';
  plus.textContent = '+';
  div.appendChild(plus);
  div.addEventListener('click', openAddPanel);
  return div;
}

function openAddPanel() {
  addPanel.hidden = false;
  addName.value = '';
  addUrl.value = '';
  addName.focus();
}

function closeAddPanel() {
  addPanel.hidden = true;
}

async function submitAdd() {
  const name = addName.value.trim();
  const url = addUrl.value.trim();
  if (!name || !url) return;
  const links = await getLinks();
  links.push({ name, url: normalizeUrl(url) });
  await saveLinks(links);
  closeAddPanel();
  render();
}

async function render() {
  const links = await getLinks();
  dock.innerHTML = '';
  links.forEach((link, i) => dock.appendChild(makeDockItem(link, i)));
  if (links.length) {
    const divider = document.createElement('div');
    divider.className = 'dock-divider';
    dock.appendChild(divider);
  }
  dock.appendChild(makeAddItem());
}

document.getElementById('addCancel').addEventListener('click', closeAddPanel);
document.getElementById('addSave').addEventListener('click', submitAdd);
addPanel.addEventListener('click', (e) => { if (e.target === addPanel) closeAddPanel(); });
[addName, addUrl].forEach((input) => {
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitAdd();
    if (e.key === 'Escape') closeAddPanel();
  });
});

tickClock();
setInterval(tickClock, 1000);
render();

// ---------------------------------------------------------------- colours

const PRESETS = ['#ff00f2', '#d0bcff', '#74df00', '#00b7ff', '#ff6b3d', '#ffc400', '#00d1a0', '#ff3b6b', '#8c9eff', '#9e9e9e'];
const $ = (id) => document.getElementById(id);
const settingsEl = $('settings');
const darkQuery = matchMedia('(prefers-color-scheme: dark)');
let settings = { ...DEFAULT_SETTINGS };
let state = {};

async function saveSettings(patch) {
  settings = { ...settings, ...patch };
  await chrome.storage.local.set({ settings });
}

function applyPalette() {
  const p = state.palette;
  if (!p) return;
  const dark = settings.mode === 'system' ? darkQuery.matches : settings.mode !== 'light';
  const c = dark ? p.dark : p.light;
  const root = document.documentElement.style;
  for (const [k, v] of Object.entries(c)) {
    if (typeof v === 'string' && v[0] === '#') root.setProperty('--' + k.replace(/_/g, '-'), v);
  }
  document.documentElement.dataset.scheme = dark ? 'dark' : 'light';
  try { localStorage.setItem('qt-palette', JSON.stringify(c)); } catch (e) { /* not critical */ }
}

function swatch(hex, active, onPick) {
  const b = document.createElement('button');
  b.className = 'swatch' + (active ? ' active' : '');
  b.style.background = hex;
  b.addEventListener('click', onPick);
  return b;
}

// Draw a picture into a preview canvas; clicking it samples that spot.
async function drawPreview(canvas, empty, src) {
  canvas.hidden = !src;
  empty.hidden = !!src;
  if (!src || canvas.dataset.src === src) return;
  canvas.dataset.src = src;
  const img = new Image();
  img.src = src;
  await img.decode();
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  canvas.getContext('2d', { willReadFrequently: true }).drawImage(img, 0, 0);
}

function pixelAt(canvas, e) {
  const r = canvas.getBoundingClientRect();
  const x = Math.floor(((e.clientX - r.left) / r.width) * canvas.width);
  const y = Math.floor(((e.clientY - r.top) / r.height) * canvas.height);
  // Average a small patch: single JPEG pixels are noisy.
  const d = canvas.getContext('2d', { willReadFrequently: true })
    .getImageData(Math.max(0, x - 1), Math.max(0, y - 1), 3, 3).data;
  let rr = 0, gg = 0, bb = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) { rr += d[i]; gg += d[i + 1]; bb += d[i + 2]; n++; }
  const hex = (v) => Math.round(v / n).toString(16).padStart(2, '0');
  return '#' + hex(rr) + hex(gg) + hex(bb);
}

function renderSettings() {
  document.querySelectorAll('#sourceSeg button').forEach((b) => b.classList.toggle('on', b.dataset.source === settings.source));
  document.querySelectorAll('#modeSeg button').forEach((b) => b.classList.toggle('on', b.dataset.mode === settings.mode));
  document.querySelectorAll('[data-pane]').forEach((s) => { s.hidden = s.dataset.pane !== settings.source; });
  $('styleSelect').value = settings.style;

  // wallpaper pane
  const wp = state.wallpaper;
  const host = state.host || {};
  drawPreview($('wpCanvas'), $('wpEmpty'), wp && wp.image);
  const connected = host.status === 'connected';
  $('wpStatus').textContent = connected
    ? (wp ? `Following your ${wp.source === 'lively' ? 'Lively' : 'Windows'} wallpaper: ${wp.title}` : 'Connected, waiting for the wallpaper…')
    : 'The Windows helper isn’t running, so the wallpaper can’t be read. Run Install.bat from the Quiet Tab folder, then reopen this tab.';
  $('wpStatus').classList.toggle('warn', !connected);
  const wpBox = $('wpSwatches');
  wpBox.innerHTML = '';
  const seeds = (wp && wp.seeds) || [];
  const picked = settings.pick && wp && settings.pick.stamp === wp.stamp ? settings.pick.hex : null;
  seeds.forEach((hex, i) => {
    const active = picked ? picked === hex : i === 0;
    wpBox.appendChild(swatch(hex, active, () => saveSettings({ pick: i === 0 ? null : { stamp: wp.stamp, hex } })));
  });
  if (picked && !seeds.includes(picked)) wpBox.appendChild(swatch(picked, true, () => {}));

  // custom pane
  $('customColor').value = settings.custom;
  const pre = $('presetSwatches');
  pre.innerHTML = '';
  PRESETS.forEach((hex) => pre.appendChild(swatch(hex, hex === settings.custom.toLowerCase(), () => saveSettings({ custom: hex }))));

  // image pane
  drawPreview($('imgCanvas'), $('imgEmpty'), settings.image);
  const imgBox = $('imgSwatches');
  imgBox.innerHTML = '';
  settings.imageSeeds.forEach((hex, i) => {
    const active = settings.imagePick ? settings.imagePick === hex : i === 0;
    imgBox.appendChild(swatch(hex, active, () => saveSettings({ imagePick: i === 0 ? null : hex })));
  });
  if (settings.imagePick && !settings.imageSeeds.includes(settings.imagePick)) {
    imgBox.appendChild(swatch(settings.imagePick, true, () => {}));
  }
}

async function loadImageFile(file) {
  const img = new Image();
  img.src = URL.createObjectURL(file);
  await img.decode();
  const scale = Math.min(1, 480 / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * scale);
  c.height = Math.round(img.naturalHeight * scale);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  URL.revokeObjectURL(img.src);
  const dataUrl = c.toDataURL('image/jpeg', 0.88);
  const imageSeeds = await extractSeeds(dataUrl);
  await saveSettings({ source: 'image', image: dataUrl, imageSeeds, imagePick: null });
}

function setupSettings() {
  const sel = $('styleSelect');
  for (const [key, def] of Object.entries(STYLES)) sel.add(new Option(def.label, key));
  sel.addEventListener('change', () => saveSettings({ style: sel.value }));

  $('gear').addEventListener('click', () => {
    settingsEl.hidden = !settingsEl.hidden;
    if (!settingsEl.hidden) chrome.runtime.sendMessage({ type: 'reconnect' });
  });
  $('settingsClose').addEventListener('click', () => { settingsEl.hidden = true; });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && addPanel.hidden) settingsEl.hidden = true; });

  document.querySelectorAll('#sourceSeg button').forEach((b) => b.addEventListener('click', () => saveSettings({ source: b.dataset.source })));
  document.querySelectorAll('#modeSeg button').forEach((b) => b.addEventListener('click', () => saveSettings({ mode: b.dataset.mode })));

  $('wpCanvas').addEventListener('click', (e) => {
    if (state.wallpaper) saveSettings({ pick: { stamp: state.wallpaper.stamp, hex: pixelAt($('wpCanvas'), e) } });
  });
  $('imgCanvas').addEventListener('click', (e) => saveSettings({ imagePick: pixelAt($('imgCanvas'), e) }));
  $('imgFile').addEventListener('change', () => { if ($('imgFile').files[0]) loadImageFile($('imgFile').files[0]); });

  $('customColor').addEventListener('input', () => saveSettings({ custom: $('customColor').value }));
  const eyedrop = $('eyedrop');
  if (!('EyeDropper' in window)) eyedrop.hidden = true;
  eyedrop.addEventListener('click', async () => {
    try {
      const { sRGBHex } = await new EyeDropper().open();
      saveSettings({ custom: sRGBHex.toLowerCase() });
    } catch (e) { /* cancelled */ }
  });


  $('openAppearance').addEventListener('click', () => chrome.tabs.create({ url: 'chrome://settings/appearance' }));

  darkQuery.addEventListener('change', applyPalette);
}

async function loadState() {
  const got = await chrome.storage.local.get(['settings', 'palette', 'wallpaper', 'host']);
  settings = { ...DEFAULT_SETTINGS, ...(got.settings || {}) };
  state = got;
  applyPalette();
  renderSettings();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  for (const k of ['palette', 'wallpaper', 'host']) if (changes[k]) state[k] = changes[k].newValue;
  if (changes.settings) settings = { ...DEFAULT_SETTINGS, ...(changes.settings.newValue || {}) };
  if (changes.palette || changes.settings) applyPalette();
  renderSettings();
});

setupSettings();
loadState();
