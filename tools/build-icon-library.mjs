// Rebuilds extension/icons/library.json (what the extension draws from) and
// extension/icons/brands/<slug>.svg (one browsable file per logo, in its brand
// colour) from the simple-icons package (CC0).
//   npm i --no-save simple-icons && node tools/build-icon-library.mjs
import fs from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const si = require('simple-icons');
const pkg = JSON.parse(fs.readFileSync(require.resolve('simple-icons').replace(/index.js$/, 'package.json'), 'utf8'));

const icons = Object.values(si)
  .map((i) => [i.slug, i.title, i.hex, i.path])
  .sort((a, b) => a[1].localeCompare(b[1]));
const out = new URL('../extension/icons/library.json', import.meta.url);
fs.writeFileSync(out, JSON.stringify({ source: 'simple-icons ' + pkg.version, icons }));
console.log(`${icons.length} icons from simple-icons ${pkg.version}`);

// One SVG per icon, so the set can be browsed in Explorer or reused elsewhere.
const brandsDir = new URL('../extension/icons/brands/', import.meta.url);
fs.rmSync(brandsDir, { recursive: true, force: true });
fs.mkdirSync(brandsDir, { recursive: true });
const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
for (const [slug, title, hex, path] of icons) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="96" height="96"><title>${esc(title)}</title><path fill="#${hex}" d="${path}"/></svg>
`;
  fs.writeFileSync(new URL(slug + '.svg', brandsDir), svg);
}
console.log(`${icons.length} SVGs in extension/icons/brands`);
