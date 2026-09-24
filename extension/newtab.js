import { STYLES, extractSeeds } from './palette.js';
import { DEFAULT_SETTINGS } from './defaults.js';
import { ICON_STYLES, loadLibrary, matchSlug, searchLibrary, drawIcon } from './icons.js';

const dock = document.getElementById('dock');
const clockH = document.getElementById('clockH');
const clockM = document.getElementById('clockM');
const clockS = document.getElementById('clockS');
const clockDate = document.getElementById('clockDate');
const addPanel = document.getElementById('addPanel');
const addName = document.getElementById('addName');
const addUrl = document.getElementById('addUrl');
const addTitle = document.getElementById('addTitle');
const addPreview = document.getElementById('addPreview');
const addIconLabel = document.getElementById('addIconLabel');
const iconSearch = document.getElementById('iconSearch');
const iconResults = document.getElementById('iconResults');

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function ordinal(n) {
  if (n % 10 === 1 && n % 100 !== 11) return n + 'st';
  if (n % 10 === 2 && n % 100 !== 12) return n + 'nd';
  if (n % 10 === 3 && n % 100 !== 13) return n + 'rd';
  return n + 'th';
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

// A link's `icon` is 'auto' (match by domain), 'site' (always the site's own icon)
// or a library slug; `glyph` caches the resolved library entry so a new tab never
// has to load the whole library.
function resolveGlyph(link, lib) {
  const choice = link.icon || 'auto';
  if (choice === 'site') return null;
  const slug = choice === 'auto' ? matchSlug(link.url, lib) : choice;
  return (slug && lib.bySlug.get(slug)) || null;
}

async function ensureGlyphs(links) {
  if (links.every((l) => 'glyph' in l)) return false;
  const lib = await loadLibrary();
  for (const l of links) if (!('glyph' in l)) l.glyph = resolveGlyph(l, lib);
  await saveLinks(links);
  return true;
}

function iconStyle() {
  return settings.iconStyle || DEFAULT_SETTINGS.iconStyle;
}

function makeDockItem(link, index) {
  const a = document.createElement('a');
  a.className = 'dock-item icon-' + iconStyle();
  a.href = link.url;
  a.dataset.name = link.name;

  const tile = document.createElement('div');
  drawIcon(tile, link, iconStyle());
  a.appendChild(tile);

  const edit = document.createElement('button');
  edit.className = 'edit';
  edit.textContent = '✎';
  edit.title = 'Edit';
  edit.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    openAddPanel(index);
  });
  a.appendChild(edit);

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
  div.addEventListener('click', () => openAddPanel(-1));
  return div;
}

// ---------------------------------------------------------------- add / edit

let editIndex = -1;
let draftIcon = 'auto';

async function refreshAddPreview() {
  const lib = await loadLibrary();
  const draft = { name: addName.value || '?', url: normalizeUrl(addUrl.value || 'example.invalid'), icon: draftIcon };
  draft.glyph = addUrl.value.trim() || draftIcon !== 'auto' ? resolveGlyph(draft, lib) : null;
  addPreview.className = 'dock-item shortcut-preview icon-' + iconStyle();
  addPreview.textContent = '';
  const tile = document.createElement('div');
  drawIcon(tile, draft, iconStyle());
  addPreview.appendChild(tile);
  addIconLabel.textContent = draftIcon === 'site' ? 'The site’s own icon'
    : draftIcon !== 'auto' ? (draft.glyph ? draft.glyph[1] : 'Automatic')
    : draft.glyph ? `Automatic: ${draft.glyph[1]}` : 'Automatic (no match yet, uses the site’s icon)';
  document.querySelectorAll('#iconChoiceRow button').forEach((b) => b.classList.toggle('on', b.dataset.choice === draftIcon));
}

async function refreshIconResults() {
  const lib = await loadLibrary();
  const found = searchLibrary(lib, iconSearch.value);
  iconResults.textContent = '';
  for (const entry of found) {
    const b = document.createElement('button');
    b.className = 'icon-result icon-' + iconStyle() + (draftIcon === entry[0] ? ' on' : '');
    b.title = entry[1];
    const tile = document.createElement('div');
    drawIcon(tile, { name: entry[1], url: 'https://example.invalid', glyph: entry }, iconStyle() === 'site' ? 'brand' : iconStyle());
    b.appendChild(tile);
    b.addEventListener('click', () => { draftIcon = entry[0]; refreshAddPreview(); refreshIconResults(); });
    iconResults.appendChild(b);
  }
  iconResults.hidden = !found.length;
}

async function openAddPanel(index) {
  editIndex = index;
  const link = index >= 0 ? (await getLinks())[index] : null;
  addTitle.textContent = link ? 'Edit shortcut' : 'Add a shortcut';
  document.getElementById('addSave').textContent = link ? 'Save' : 'Add';
  addName.value = link ? link.name : '';
  addUrl.value = link ? link.url : '';
  draftIcon = link ? link.icon || 'auto' : 'auto';
  iconSearch.value = '';
  iconResults.hidden = true;
  addPanel.hidden = false;
  addName.focus();
  refreshAddPreview();
}

function closeAddPanel() {
  addPanel.hidden = true;
}

async function submitAdd() {
  const name = addName.value.trim();
  const url = addUrl.value.trim();
  if (!name || !url) return;
  const lib = await loadLibrary();
  const links = await getLinks();
  const link = { name, url: normalizeUrl(url), icon: draftIcon };
  link.glyph = resolveGlyph(link, lib);
  if (editIndex >= 0) links[editIndex] = link;
  else links.push(link);
  await saveLinks(links);
  closeAddPanel();
  render();
}

async function render() {
  const links = await getLinks();
  if (await ensureGlyphs(links)) return render();
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
[addName, addUrl, iconSearch].forEach((input) => {
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && input !== iconSearch) submitAdd();
    if (e.key === 'Escape') closeAddPanel();
  });
});
let previewTimer = null;
[addName, addUrl].forEach((input) => input.addEventListener('input', () => {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(refreshAddPreview, 250);
}));
iconSearch.addEventListener('input', refreshIconResults);
document.querySelectorAll('#iconChoiceRow button').forEach((b) => b.addEventListener('click', () => {
  draftIcon = b.dataset.choice;
  refreshAddPreview();
  refreshIconResults();
}));

tickClock();
setInterval(tickClock, 1000);

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
  renderIconStyles();
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

// Six sample shortcuts for the style previews when the dock is still empty.
const SAMPLE_LINKS = ['github.com', 'youtube.com', 'spotify.com', 'web.whatsapp.com', 'reddit.com', 'netflix.com']
  .map((d) => ({ name: d, url: 'https://' + d, icon: 'auto' }));
let iconStylesKey = null;

async function renderIconStyles() {
  const links = (await getLinks()).slice(0, 6);
  const key = JSON.stringify([settings.iconStyle, links.map((l) => [l.url, l.glyph && l.glyph[0]])]);
  if (key === iconStylesKey) return;
  iconStylesKey = key;
  let preview = links;
  if (!preview.length) {
    const lib = await loadLibrary();
    preview = SAMPLE_LINKS.map((l) => ({ ...l, glyph: lib.bySlug.get(matchSlug(l.url, lib)) || null }));
  }
  const box = $('iconStyles');
  box.textContent = '';
  for (const style of ICON_STYLES) {
    const opt = document.createElement('button');
    opt.className = 'icon-style' + (style.id === settings.iconStyle ? ' on' : '');
    const head = document.createElement('div');
    head.className = 'icon-style-head';
    head.innerHTML = '<b></b><span></span>';
    head.querySelector('b').textContent = style.label;
    head.querySelector('span').textContent = style.hint;
    const row = document.createElement('div');
    row.className = 'mini-dock';
    for (const link of preview) {
      const item = document.createElement('div');
      item.className = 'dock-item mini icon-' + style.id;
      const tile = document.createElement('div');
      drawIcon(tile, link, style.id);
      item.appendChild(tile);
      row.appendChild(item);
    }
    opt.append(head, row);
    opt.addEventListener('click', () => saveSettings({ iconStyle: style.id }));
    box.appendChild(opt);
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
  render();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  for (const k of ['palette', 'wallpaper', 'host']) if (changes[k]) state[k] = changes[k].newValue;
  if (changes.settings) settings = { ...DEFAULT_SETTINGS, ...(changes.settings.newValue || {}) };
  if (changes.palette || changes.settings) applyPalette();
  const oldStyle = changes.settings && changes.settings.oldValue && changes.settings.oldValue.iconStyle;
  if (changes.links || (changes.settings && oldStyle !== settings.iconStyle)) render();
  renderSettings();
});

setupSettings();
loadState();
