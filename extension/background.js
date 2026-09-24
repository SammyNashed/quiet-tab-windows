// Holds the one connection to the Windows helper, turns whatever the colour
// source is into a palette, and stores it for every New Tab page to pick up.
// An open native port keeps this service worker alive, so wallpaper changes
// land even when no New Tab is open.

import { buildPalette, extractSeeds } from './palette.js';
import { DEFAULT_SETTINGS } from './defaults.js';

const HOST = 'com.quiettab.helper';
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
  const { wallpaper } = await chrome.storage.local.get('wallpaper');
  const seed = pickSeed(settings, wallpaper);
  const palette = {
    seed,
    dark: buildPalette(seed, settings.style, true),
    light: buildPalette(seed, settings.style, false),
  };
  await chrome.storage.local.set({ palette });
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
});

chrome.runtime.onInstalled.addListener(recompute);
chrome.runtime.onStartup.addListener(connectHost);
connectHost();
