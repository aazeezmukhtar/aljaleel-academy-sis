'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const header = read('views/partials/header.ejs');
const order = ['acadme-tokens.css','acadme-components.css','acadme-shells.css','acadme-students.css','acadme-attendance.css','acadme-results.css']
  .map(name => header.indexOf(name));
assert.ok(order.every((value, index) => value >= 0 && (index === 0 || value > order[index - 1])),
  'Results styles must load after the shared layers and prior feature styles');
assert.doesNotMatch(header, /\\n\s*<link[^>]*acadme-results/,
  'Results stylesheet link must use a real newline');

const css = read('public/css/acadme-results.css');
for (const selector of ['.results-overview-page','.results-manager-page','.results-bulk-select-page',
  '.results-setup-page','.results-traits-page','.results-import-page']) {
  assert.ok(css.includes(selector), `Missing Results presentation scope: ${selector}`);
}
assert.match(css, /@media\(max-width:640px\)/);
assert.match(css, /prefers-reduced-motion:reduce/);
const tokenSource = read('public/css/acadme-tokens.css');
const defined = new Set([...tokenSource.matchAll(/(--acm-[\w-]+)\s*:/g)].map(match => match[1]));
const used = [...css.matchAll(/var\((--acm-[\w-]+)/g)].map(match => match[1]);
for (const token of used) assert.ok(defined.has(token), `Undefined AcadMe token: ${token}`);

const views = [
  ['views/results/index.ejs','results-overview-page'],
  ['views/results/manager.ejs','results-manager-page'],
  ['views/results/bulk_select.ejs','results-bulk-select-page'],
  ['views/results/setup.ejs','results-setup-page'],
  ['views/results/traits.ejs','results-traits-page'],
  ['views/results/import.ejs','results-import-page']
];
for (const [file, scope] of views) {
  const source = read(file);
  assert.match(source, new RegExp(`<main class="main-content ${scope}">`), `${file} must use its feature scope`);
  ejs.compile(source, { filename: path.join(__dirname, '..', file) });
}

const manager = read('views/results/manager.ejs');
assert.match(manager, /async function prepareResultsOffline\(\)/);
assert.match(manager, /function saveResults\(/);
assert.match(manager, /saveResults\('draft'/);
assert.match(manager, /saveResults\('submitted'/);
assert.match(manager, /prepareResultsOfflineBtn/);
assert.match(manager, /resultsOfflinePreparationStatus/);

console.log('AcadMe Results UI presentation checks passed.');
