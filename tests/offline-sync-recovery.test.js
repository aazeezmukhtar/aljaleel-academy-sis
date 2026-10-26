'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'offline-handler.js'), 'utf8');

function check(name, fn) {
  try {
    fn();
    console.log('PASS: ' + name);
  } catch (error) {
    console.error('FAIL: ' + name + ' — ' + error.message);
    process.exitCode = 1;
  }
}

check('offline handler parses as JavaScript', () => {
  new Function(source);
});

check('sync lock is released in a finally block', () => {
  const syncStart = source.indexOf('async function syncData()');
  const syncEnd = source.indexOf('// ─── UI Updates', syncStart);
  assert(syncStart >= 0 && syncEnd > syncStart, 'syncData function boundaries were not found');
  const syncSource = source.slice(syncStart, syncEnd);
  assert.match(syncSource, /finally\s*\{\s*_isSyncing\s*=\s*false;\s*\}/);
});

check('queue read errors are handled separately for attendance and results', () => {
  const syncStart = source.indexOf('async function syncData()');
  const syncEnd = source.indexOf('// ─── UI Updates', syncStart);
  const syncSource = source.slice(syncStart, syncEnd);
  assert.match(syncSource, /Could not read attendance queue/);
  assert.match(syncSource, /Could not read results queue/);
  assert.match(syncSource, /let attendanceItems = \[\]/);
  assert.match(syncSource, /let resultItems = \[\]/);
});

check('failed sync items remain queued unless server confirms success', () => {
  const syncStart = source.indexOf('async function syncData()');
  const syncEnd = source.indexOf('// ─── UI Updates', syncStart);
  const syncSource = source.slice(syncStart, syncEnd);
  assert.match(syncSource, /if \(data\.success\)\s*\{\s*await deleteQueued/);
  assert.match(syncSource, /remains queued/);
});

if (process.exitCode) process.exit(process.exitCode);
console.log('Offline sync recovery checks complete.');
