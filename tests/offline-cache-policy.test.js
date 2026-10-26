'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'sw.js'), 'utf8');

function check(name, fn) {
  try {
    fn();
    console.log('PASS: ' + name);
  } catch (error) {
    console.error('FAIL: ' + name + ' — ' + error.message);
    process.exitCode = 1;
  }
}

check('service worker script parses as JavaScript', () => {
  // Compile without executing service-worker globals.
  new Function(source);
});

check('cache version is bumped to retire previous broad-navigation cache', () => {
  assert.match(source, /const CACHE_NAME = 'aljaleel-sis-v7'/);
});

check('only explicit approved paths qualify for offline page caching', () => {
  assert.match(source, /const OFFLINE_PAGE_PATHS = new Set\(/);
  assert.match(source, /function isOfflinePage\(request, url\)/);
  assert.match(source, /OFFLINE_PAGE_PATHS\.has\(url\.pathname\)/);
});

check('authenticated page caching requires a successful, non-redirected HTML navigation', () => {
  assert.match(source, /res\.status === 200 && !res\.redirected/);
  assert.match(source, /request\.mode === 'navigate'/);
  assert.match(source, /includes\('text\/html'\)/);
});

check('login and logout routes are not served from offline page cache', () => {
  assert.match(source, /if \(AUTH_PATHS\.has\(url\.pathname\) \|\| LOGOUT_PATHS\.has\(url\.pathname\)\)/);
  assert.match(source, /Sign-in and sign-out require an internet connection/);
});

check('private page cache is cleared when login/logout or auth redirect is detected', () => {
  assert.match(source, /async function clearPrivatePageCache\(cache\)/);
  assert.match(source, /await clearPrivatePageCache\(cache\)/);
  assert.match(source, /const redirectedToAuth/);
});

check('cross-origin requests are not broadly intercepted or cached', () => {
  assert.match(source, /if \(url\.origin !== self\.location\.origin\) return/);
  assert.match(source, /if \(isStaticAsset\(url\)\)/);
});

check('unknown offline routes do not fall back to a cached dashboard', () => {
  assert.doesNotMatch(source, /return caches\.match\('\/dashboard'\)/);
  assert.match(source, /No generic dashboard fallback/);
});

check('safe offline fallback page is included among static assets', () => {
  assert.match(source, /'\/offline-unavailable\.html'/);
});

if (process.exitCode) process.exit(process.exitCode);
console.log('Offline cache policy checks complete.');
