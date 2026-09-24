// Holds the one connection to the Windows helper, turns whatever the colour
// source is into a palette, and stores it for every New Tab page to pick up.
// An open native port keeps this service worker alive, so wallpaper changes
// land even when no New Tab is open.

import { buildPalette, extractSeeds } from './palette.js';
import { DEFAULT_SETTINGS } from './defaults.js';

const HOST = 'com.quiettab.helper';
// Helium's toolbar colour variant (Chromium's BrowserColorVariant), matched to the
// page style: 1 tonal spot, 2 neutral, 3 vibrant, 4 expressive. Verified on
// Helium 0.18 for Windows -- 2 turns the toolbar grey there.
const HELIUM_VARIANTS = { tonal_spot: 1, neutral: 2, monochrome: 2, expressive: 4 };
const heliumVariant = (style) => HELIUM_VARIANTS[style] || 3;

let port = null;

async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}

function connectHost() {
  if (port) return;
  try {
    port = chrome.runtime.connectNative(HOST);
  } catch (e) {
    port = null;
    chrome.storage.local.set({ host: { status: 'missing', error: String(e.message || e) } });
    return;
  }
  port.onMessage.addListener(onHostMessage);
  port.onDisconnect.addListener(() => {
    const error = chrome.runtime.lastError ? chrome.runtime.lastError.message : 'disconnected';
    port = null;
    chrome.storage.local.set({ host: { status: 'missing', error } });
  });
}

async function onHostMessage(msg) {
  if (msg.type === 'hello') {
    await chrome.storage.local.set({ host: { status: 'connected', version: msg.version, helium: msg.helium } });
    return;
  }
  if (msg.type === 'wallpaper') {
    const { wallpaper } = await chrome.storage.local.get('wallpaper');
    if (wallpaper && wallpaper.stamp === msg.stamp && wallpaper.seeds && wallpaper.seeds.length) return;
    let seeds = [];
    try {
      if (msg.image) seeds = await extractSeeds(msg.image);
      else if (msg.color) seeds = [msg.color];
    } catch (e) {
      console.warn('Quiet Tab: could not read wallpaper', e);
    }
    await chrome.storage.local.set({
      wallpaper: { stamp: msg.stamp, source: msg.source, title: msg.title, image: msg.image || null, seeds },
    });
    await recompute();
    return;
  }
}

function pickSeed(settings, wallpaper) {
  if (settings.source === 'custom') return settings.custom;
  if (settings.source === 'image') {
    return settings.imagePick || settings.imageSeeds[0] || settings.custom;
  }
  if (!wallpaper || !wallpaper.seeds || !wallpaper.seeds.length) return settings.custom;
  if (settings.pick && settings.pick.stamp === wallpaper.stamp) return settings.pick.hex;
  return wallpaper.seeds[0];
}

async function recompute() {
  const settings = await getSettings();
  const { wallpaper, heliumAccent } = await chrome.storage.local.get(['wallpaper', 'heliumAccent']);
  const seed = pickSeed(settings, wallpaper);
  const palette = {
    seed,
    dark: buildPalette(seed, settings.style, true),
    light: buildPalette(seed, settings.style, false),
  };
  await chrome.storage.local.set({ palette });

  const accentKey = seed + '/' + heliumVariant(settings.style);
  if (settings.heliumSync && port && accentKey !== heliumAccent) {
    port.postMessage({ type: 'accent', hex: seed, variant: heliumVariant(settings.style), restart: false });
    await chrome.storage.local.set({ heliumAccent: accentKey });
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.settings) recompute();
});

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.type === 'reconnect') {
    connectHost();
    if (port) port.postMessage({ type: 'refresh' });
    reply({ ok: !!port });
  }
  if (msg.type === 'heliumApplyNow') {
    connectHost();
    if (!port) { reply({ ok: false }); return; }
    getSettings().then(async (settings) => {
      const { wallpaper } = await chrome.storage.local.get('wallpaper');
      const seed = pickSeed(settings, wallpaper);
      await chrome.storage.local.set({ heliumAccent: seed + '/' + heliumVariant(settings.style) });
      port.postMessage({ type: 'accent', hex: seed, variant: heliumVariant(settings.style), restart: true });
      reply({ ok: true });
    });
    return true;
  }
});

chrome.runtime.onInstalled.addListener(recompute);
chrome.runtime.onStartup.addListener(connectHost);
connectHost();
