'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

const header = read('views/partials/header.ejs');
const layers = ['acadme-tokens.css','acadme-components.css','acadme-shells.css','acadme-students.css','acadme-attendance.css','acadme-results.css','acadme-finance.css']
  .map(file => header.indexOf(file));
assert.ok(layers.every((value, index) => value >= 0 && (index === 0 || value > layers[index - 1])),
  'Finance styles must load after the shared layers and prior feature styles');
assert.doesNotMatch(header, /\\n\s*<link[^>]*acadme-finance/);

const css = read('public/css/acadme-finance.css');
const tokenSource = read('public/css/acadme-tokens.css');
const defined = new Set([...tokenSource.matchAll(/(--acm-[\w-]+)\s*:/g)].map(match => match[1]));
for (const match of css.matchAll(/var\((--acm-[\w-]+)/g)) {
  assert.ok(defined.has(match[1]), `Undefined AcadMe token: ${match[1]}`);
}
assert.match(css, /@media\(max-width:760px\)/);
assert.match(css, /@media\(prefers-reduced-motion:reduce\)/);
assert.match(css, /@media print/);

const views = [
  ['views/fees/manager.ejs','fees-manager-page'],
  ['views/fees/pay.ejs','fees-payment-page'],
  ['views/fees/receipt.ejs','fees-receipt-page'],
  ['views/fees/setup.ejs','fees-setup-page'],
  ['views/fees/student-details.ejs','fees-student-page'],
  ['views/reports/fees.ejs','fees-report-page'],
  ['views/reports/finance/debtors.ejs','finance-debtors-page'],
  ['views/reports/finance/index.ejs','finance-reports-page'],
  ['views/reports/finance/status.ejs','finance-status-page']
];
for (const [file, scope] of views) {
  const source = read(file);
  assert.match(source, new RegExp(`class="main-content ${scope}"`), `${file} must have a feature scope`);
  ejs.compile(source, { filename: path.join(__dirname, '..', file) });
}

const pay = read('views/fees/pay.ejs');
assert.match(pay, /action="\/fees\/pay"/);
assert.match(pay, /name="amount_paid"/);
assert.match(pay, /name="payment_method"/);
const manager = read('views/fees/manager.ejs');
assert.match(manager, /action="\/fees\/manager"/);
assert.match(manager, /\/fees\/student\//);
const receipt = read('views/fees/receipt.ejs');
assert.match(receipt, /window\.print\(\)/);
assert.match(receipt, /payment\.receipt_number/);
console.log('AcadMe Finance UI presentation checks passed.');
