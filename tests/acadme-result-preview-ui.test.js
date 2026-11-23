'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

for (const file of ['views/results/report.ejs', 'views/results/cumulative.ejs']) {
  const page = read(file);
  assert.match(page, /<body class="report-preview-page">/);
  assert.match(page, /acadme-result-preview\.css/);
  assert.match(page, /class="no-print report-preview-toolbar"/);
  assert.match(page, /class="no-print report-preview-toolbar-spacer"/);
  assert.match(page, /href="\/portal\/academics\/results#report-cards"/);
  assert.match(page, /onclick="window\.print\(\)"/);
  assert.match(page, /@media print/);
  assert.match(page, /\.report-card \{/);
}
const css = read('public/css/acadme-result-preview.css');
assert.match(css, /@media screen/);
assert.match(css, /max-width: 560px/);
assert.match(css, /overflow-x: auto/);
assert.match(css, /prefers-reduced-motion: reduce/);
assert.ok(!/@media\s+print\s*\{[^}]*\.report-card\s*\{[^}]*padding/i.test(css),
  'Preview CSS must not override print report padding');
const pkg = JSON.parse(read('package.json'));
assert.equal(pkg.scripts['test:acadme-result-preview-ui'],
  'node tests/acadme-result-preview-ui.test.js');
console.log('AcadMe Result Report Preview UI source checks passed.');
