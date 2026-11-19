'use strict';

const assert = require('assert');

const settings = new Map([[1, '82'], [2, 'not-a-number'], [3, '0']]);
const fakeDb = {
  get: async (sql, params) => {
    assert(sql.includes("key = 'attendance.minimum_percentage'"),
      'Threshold must use the setting already exposed in School Settings.');
    return settings.has(Number(params[0])) ? { value: settings.get(Number(params[0])) } : null;
  }
};
const dbPath = require.resolve('../utils/db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fakeDb };

const thresholdService = require('../services/attendanceThresholdService');

(async () => {
  assert.strictEqual(await thresholdService.getThreshold(1), 82,
    'Portal and administrative reports must share the saved school threshold.');
  assert.strictEqual(await thresholdService.getThreshold(1, '67.5'), 67.5,
    'An explicit report filter may temporarily override the saved threshold.');
  assert.strictEqual(await thresholdService.getThreshold(2), 75,
    'Invalid stored settings fall back to the documented default.');
  assert.strictEqual(await thresholdService.getThreshold(3), 0,
    'Zero is a valid configured threshold.');
  assert.strictEqual(await thresholdService.getThreshold(4), 75,
    'A missing setting uses the default.');
  await assert.rejects(() => thresholdService.getThreshold(1, 101), /0 to 100/);
  await assert.rejects(() => thresholdService.getThreshold(0), /valid school ID/);
  console.log('[attendance-threshold] saved school setting, explicit override, default and validation passed.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
