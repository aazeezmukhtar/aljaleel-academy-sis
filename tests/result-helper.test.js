'use strict';

// Pure unit tests for result scoring. No database, session, or production services.
const assert = require('assert');
const { computeResult, getGrade } = require('../utils/resultHelper');

const cases = [
  { total: 100, grade: 'A' },
  { total: 70, grade: 'A' },
  { total: 69.99, grade: 'B' },
  { total: 60, grade: 'B' },
  { total: 59.99, grade: 'C' },
  { total: 50, grade: 'C' },
  { total: 49.99, grade: 'D' },
  { total: 40, grade: 'D' },
  { total: 39.99, grade: 'E' },
  { total: 30, grade: 'E' },
  { total: 29.99, grade: 'F' },
  { total: 0, grade: 'F' }
];

for (const item of cases) {
  assert.strictEqual(getGrade(item.total), item.grade, 'grade boundary for ' + item.total);
}

assert.deepStrictEqual(computeResult(20, 20, 60), { total: 100, grade: 'A' });
assert.deepStrictEqual(computeResult('15', '15', '40'), { total: 70, grade: 'A' });
assert.deepStrictEqual(computeResult(0, 0, 0), { total: 0, grade: 'F' });
assert.deepStrictEqual(computeResult(undefined, null, ''), { total: 0, grade: 'F' });
assert.deepStrictEqual(computeResult('invalid', 10, 20), { total: 30, grade: 'E' });

console.log('Result helper unit tests passed (grade boundaries and score input handling).');
