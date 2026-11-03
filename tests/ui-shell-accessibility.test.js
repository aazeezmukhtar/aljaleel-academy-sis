'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const header = read('views/partials/header.ejs');
const sidebar = read('views/partials/sidebar.ejs');
const css = read('public/css/main.css');

function check(name, fn) {
  try {
    fn();
    console.log('PASS: ' + name);
  } catch (error) {
    console.error('FAIL: ' + name + ' — ' + error.message);
    process.exitCode = 1;
  }
}

check('mobile menu trigger exposes its controlled navigation state', () => {
  assert.match(header, /aria-controls="main-sidebar"/);
  assert.match(header, /aria-expanded="false"/);
  assert.match(sidebar, /aria-controls="main-sidebar"/);
  assert.match(sidebar, /aria-expanded="false"/);
});

check('mobile sidebar can close with Escape and overlay interaction', () => {
  assert.match(sidebar, /event\.key === 'Escape'/);
  assert.match(sidebar, /overlay\.addEventListener\('click'/);
  assert.match(sidebar, /setSidebarOpen\(false\)/);
});

check('mobile sidebar state is synchronized with trigger and viewport changes', () => {
  assert.match(sidebar, /button\.setAttribute\('aria-expanded'/);
  assert.match(sidebar, /window\.matchMedia\('\(max-width: 991px\)'\)/);
  assert.match(sidebar, /sidebar\.classList\.remove\('active'\)/);
});

check('mobile menu closes after selecting a navigation destination', () => {
  assert.match(sidebar, /sidebar\.querySelectorAll\('a'\)/);
  assert.match(sidebar, /if \(mobileQuery\.matches\) setSidebarOpen\(false\)/);
});

check('mobile layout accounts for device safe areas', () => {
  assert.match(css, /env\(safe-area-inset-bottom/);
  assert.match(css, /bottom: calc\(60px \+ env\(safe-area-inset-bottom/);
});

check('interactive navigation has visible keyboard focus and reduced motion is respected', () => {
  assert.match(css, /\.mobile-hamburger:focus-visible/);
  assert.match(css, /\.sidebar a:focus-visible/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});
