// Runs before first paint: apply the last palette straight from localStorage so a
// new tab never flashes the default colours while chrome.storage answers.
(function () {
  try {
    const c = JSON.parse(localStorage.getItem('qt-palette'));
    if (!c) return;
    const root = document.documentElement.style;
    for (const [k, v] of Object.entries(c)) {
      if (typeof v === 'string' && v[0] === '#') root.setProperty('--' + k.replace(/_/g, '-'), v);
    }
    document.documentElement.dataset.scheme = c.dark ? 'dark' : 'light';
  } catch (e) { /* first run, or storage blocked: CSS defaults */ }
})();
