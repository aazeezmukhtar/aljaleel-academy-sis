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
  assert.match(source, /const CACHE_NAME = 'aljaleel-sis-v9'/);
});

check('only explicit approved paths qualify for offline page caching', () => {
  assert.match(source, /const OFFLINE_PAGE_PATHS = new Set\(/);
  assert.match(source, /function isOfflinePage\(request, url\)/);
  assert.match(source, /OFFLINE_PAGE_PATHS\.has\(url\.pathname\)/);
});

check('authenticated navigation caching requires successful, non-redirected HTML', () => {
  assert.match(source, /res\.status === 200 && !res\.redirected/);
  assert.match(source, /request\.mode === 'navigate'/);
  assert.match(source, /includes\('text\/html'\)/);
});

check('explicit attendance preparation fetches are cached and can be verified', () => {
  assert.match(source, /function isOfflinePreparationRequest\(request, url\)/);
  assert.match(source, /request\.headers\.get\('X-AcadMe-Offline-Prepare'\) === '1'/);
  assert.match(source, /isOfflinePage\(request, url\) \|\| isPreparation/);
  assert.match(source, /headers\.set\('X-AcadMe-Offline-Cached', '1'\)/);
  assert.match(source, /cachedSuccessfully/);
});

check('attendance page relies on active-worker confirmation, not a hard-coded cache version', () => {
  const attendanceIndex = fs.readFileSync(path.join(__dirname, '..', 'views', 'attendance', 'index.ejs'), 'utf8');
  assert.match(attendanceIndex, /X-AcadMe-Offline-Cached/);
  assert.doesNotMatch(attendanceIndex, /caches\.open\(['"]aljaleel-sis-v\d+['"]\)/);
});

check('attendance fallback never reuses a different date for the same class', () => {
  assert.match(source, /Attendance must match the exact class AND date/);
  assert.doesNotMatch(source, /cachedUrl\.searchParams\.get\('class_id'\) === classId/);
});

check('entry cache matching requires class/date for attendance and class/subject for results', () => {
  assert.match(source, /function matchesOfflineEntryContext\(requestedUrl, cachedUrl\)/);
  assert.match(source, /requiredKeys = \['class_id', 'date'\]/);
  assert.match(source, /requiredKeys = \['class_id', 'subject_id'\]/);
  assert.match(source, /requestedUrl\.searchParams\.get\(key\) === cachedUrl\.searchParams\.get\(key\)/);
});

check('entry cache context matcher behaves safely for actual URL combinations', () => {
  const start = source.indexOf('function matchesOfflineEntryContext(requestedUrl, cachedUrl) {');
  assert.notStrictEqual(start, -1, 'matcher function must exist');
  const end = source.indexOf('\n}\n', start);
  assert.notStrictEqual(end, -1, 'matcher function must close');
  const matcherSource = source.slice(start, end + 2);
  const matchesOfflineEntryContext = new Function('URL', matcherSource + '\nreturn matchesOfflineEntryContext;')(URL);
  const url = (value) => new URL(value, 'https://acadme.example');

  assert.strictEqual(
    matchesOfflineEntryContext(url('/attendance/take?class_id=4&date=2026-10-26'), url('/attendance/take?date=2026-10-26&class_id=4')),
    true,
    'query parameter order should not matter'
  );
  assert.strictEqual(
    matchesOfflineEntryContext(url('/attendance/take?class_id=4&date=2026-10-26'), url('/attendance/take?class_id=4&date=2026-10-25')),
    false,
    'attendance must not reuse another date'
  );
  assert.strictEqual(
    matchesOfflineEntryContext(url('/attendance/take?class_id=5&date=2026-10-26'), url('/attendance/take?class_id=4&date=2026-10-26')),
    false,
    'attendance must not reuse another class'
  );
  assert.strictEqual(
    matchesOfflineEntryContext(url('/results/manage?class_id=4&subject_id=2&session=2026%2F2027&term=1st%20Term'), url('/results/manage?term=1st%20Term&subject_id=2&class_id=4&session=2026%2F2027')),
    true,
    'result context should match when only parameter order differs'
  );
  assert.strictEqual(
    matchesOfflineEntryContext(url('/results/manage?class_id=4&subject_id=2'), url('/results/manage?class_id=4&subject_id=3')),
    false,
    'results must not reuse another subject'
  );
  assert.strictEqual(
    matchesOfflineEntryContext(url('/results/manage?class_id=4&subject_id=2&session=2026%2F2027'), url('/results/manage?class_id=4&subject_id=2&session=2025%2F2026')),
    false,
    'results must not reuse another session'
  );
  assert.strictEqual(
    matchesOfflineEntryContext(url('/results/manage?class_id=4'), url('/results/manage?class_id=4&subject_id=2')),
    false,
    'results without a subject must not match an arbitrary sheet'
  );
  assert.strictEqual(
    matchesOfflineEntryContext(url('/results/manage?class_id=4&subject_id=2'), url('/results/manage?class_id=4&subject_id=2&term=2nd%20Term')),
    false,
    'a missing requested term must not match a cached sheet with a term'
  );
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
  assert.match(source, /No generic dashboard fallback|No generic dashboard fallback/);
});

check('safe offline fallback page is included among static assets', () => {
  assert.match(source, /'\/offline-unavailable\.html'/);
});

check('approved read-only routes include dashboard, students, academics, results, calendar, and announcements', () => {
  for (const route of ['/dashboard', '/students', '/academics', '/results', '/calendar', '/announcements']) {
    assert.ok(source.includes("'" + route + "'"), 'missing approved route: ' + route);
  }
  assert.doesNotMatch(source, /'\/fees(?:\/manager)?'|'\/reports'|'\/settings'/);
});

check('versioned same-origin assets share an unversioned cache key', () => {
  assert.match(source, /function staticCacheKey\(url\)/);
  assert.match(source, /url\.origin \+ url\.pathname/);
});

check('installed PWA registers service worker before standalone early return', () => {
  const installer = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'pwa-installer.js'), 'utf8');
  assert.ok(installer.indexOf("navigator.serviceWorker.register('/sw.js')") < installer.indexOf('if (isStandalone)'));
});

check('manifest and Home links use protected dashboard route', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'manifest.json'), 'utf8'));
  const sidebar = fs.readFileSync(path.join(__dirname, '..', 'views', 'partials', 'sidebar.ejs'), 'utf8');
  assert.strictEqual(manifest.start_url, '/dashboard');
  assert.ok((sidebar.match(/href="\/dashboard" class=/g) || []).length >= 2);
});

if (process.exitCode) process.exit(process.exitCode);
console.log('Offline cache policy checks complete.');