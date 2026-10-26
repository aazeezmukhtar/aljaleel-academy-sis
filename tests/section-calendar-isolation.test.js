'use strict';

// Controller tests with mocked DB methods; never opens a database or touches production records.
process.env.NODE_ENV = 'test';
process.env.DB_TYPE = 'sqlite';
delete process.env.DATABASE_URL;
delete process.env.DB_POOL_URL;

const assert = require('assert');
const db = require('../utils/db');
const tenantHelper = require('../utils/tenantHelper');
const controller = require('../controllers/settingsController');

function response() {
  return { redirected: null, redirect(url) { this.redirected = url; return this; }, status() { return this; }, send(value) { this.sent = value; return this; } };
}

async function withMocks(fn) {
  const originals = {
    all: db.all, get: db.get, run: db.run, transaction: db.transaction,
    clearTenantCache: tenantHelper.clearTenantCache
  };
  try { await fn(); }
  finally {
    db.all = originals.all;
    db.get = originals.get;
    db.run = originals.run;
    db.transaction = originals.transaction;
    tenantHelper.clearTenantCache = originals.clearTenantCache;
  }
}

async function testGlobalSettingsDoNotOverwriteSectionCalendars() {
  await withMocks(async () => {
    const calls = [];
    db.get = async () => null;
    db.run = async (sql, params) => { calls.push({ sql, params }); return { changes: 1 }; };
    db.transaction = async cb => cb();
    tenantHelper.clearTenantCache = () => {};
    const res = response();
    await controller.updateSettings({
      schoolId: 1,
      session: { staff: { school_id: 1, role: 'Admin' } },
      body: { current_session: '2027/2028', current_term: '1st Term' }
    }, res);

    assert.ok(res.redirected.includes('success=Settings updated successfully'));
    assert.ok(calls.some(c => c.sql.includes('UPDATE schools SET') && c.sql.includes('current_session')));
    assert.ok(!calls.some(c => c.sql.includes('UPDATE sections')), 'Global settings must not overwrite section-specific calendars');
    assert.ok(calls.some(c => c.sql.includes('INSERT INTO settings') && c.params.includes('current_session')));
  });
}

async function testSectionCalendarOnlyUpdatesAcademySections() {
  await withMocks(async () => {
    const calls = [];
    db.all = async sql => {
      assert.ok(sql.includes('FROM sections WHERE school_id = ?'));
      return [{ id: 1 }, { id: 2 }];
    };
    db.get = async () => { throw new Error('Section calendar update should not rewrite global settings'); };
    db.run = async (sql, params) => { calls.push({ sql, params }); return { changes: 1 }; };
    db.transaction = async cb => cb();
    tenantHelper.clearTenantCache = () => {};
    const res = response();
    await controller.updateSectionCalendar({
      session: { staff: { school_id: 1, role: 'Admin' } },
      body: {
        sections_1_session: '2026/2027', sections_1_term: '2nd Term',
        sections_2_session: '2027/2028', sections_2_term: '1st Term'
      }
    }, res);

    assert.ok(res.redirected.includes('Section calendars updated successfully'));
    const updates = calls.filter(c => c.sql.includes('UPDATE sections SET current_session'));
    assert.strictEqual(updates.length, 2);
    assert.deepStrictEqual(updates.map(c => c.params), [
      ['2026/2027', '2nd Term', 1, 1],
      ['2027/2028', '1st Term', 2, 1]
    ]);
    assert.ok(!calls.some(c => c.sql.includes('UPDATE schools') || c.sql.includes('INSERT INTO settings') || c.sql.includes('UPDATE settings')),
      'Section calendar updates must not change global school/settings calendar');
  });
}

async function testInvalidSectionCalendarIsRejectedBeforeWrites() {
  await withMocks(async () => {
    db.all = async () => [{ id: 1 }];
    let transactionStarted = false;
    let writes = 0;
    db.transaction = async cb => { transactionStarted = true; return cb(); };
    db.run = async () => { writes++; };
    tenantHelper.clearTenantCache = () => {};
    const res = response();
    await controller.updateSectionCalendar({
      session: { staff: { school_id: 1, role: 'Admin' } },
      body: { sections_1_session: 'not-a-session', sections_1_term: '1st Term' }
    }, res);
    assert.ok(res.redirected.includes('Invalid or incomplete section calendar'));
    assert.strictEqual(transactionStarted, false);
    assert.strictEqual(writes, 0);
  });
}

(async () => {
  await testGlobalSettingsDoNotOverwriteSectionCalendars();
  await testSectionCalendarOnlyUpdatesAcademySections();
  await testInvalidSectionCalendarIsRejectedBeforeWrites();
  console.log('[section-calendar-isolation] Global/section isolation and validation tests passed.');
})().catch(err => {
  console.error('[section-calendar-isolation] Test failed:', err);
  process.exitCode = 1;
});
