// Rebuilds extension/icons/library.json from the simple-icons package (CC0).
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
