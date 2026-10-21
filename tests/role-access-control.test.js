'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { isAdminOrBursar } = require('../middleware/authMiddleware');

function invoke(role, schoolId = 7) {
    const req = { session: role ? { staff: { role, school_id: schoolId } } : {} };
    const res = {
        statusCode: 200,
        message: null,
        status(code) { this.statusCode = code; return this; },
        send(message) { this.message = message; return this; }
    };
    let nextCalled = false;
    isAdminOrBursar(req, res, () => { nextCalled = true; });
    return { req, res, nextCalled };
}

for (const role of ['Admin', 'Bursar']) {
    const result = invoke(role, 7);
    assert.strictEqual(result.nextCalled, true, role + ' should be allowed');
    assert.strictEqual(result.req.schoolId, 7, role + ' should receive school context');
}

for (const role of ['Teacher', 'Staff', undefined, 'Student']) {
    const result = invoke(role);
    assert.strictEqual(result.nextCalled, false, String(role) + ' should not be allowed');
    assert.strictEqual(result.res.statusCode, 403, String(role) + ' should receive 403');
}

const feeRoutes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'feeRoutes.js'), 'utf8');
assert.match(feeRoutes, /router\.use\(isAdminOrBursar\)/, 'all fee routes must have finance role protection');

const auditController = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'reportController.js'), 'utf8');
assert.match(auditController, /res\.render\('reports\/audit'/, 'audit logs must render the existing reports/audit view');
assert.match(auditController, /LEFT JOIN staff/, 'audit log rows should include staff identity details');

const reportRoutes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'reportRoutes.js'), 'utf8');
assert.match(reportRoutes, /router\.get\('\/finance',\s*isAdminOrBursar,/, 'finance report dashboard must be restricted');
assert.match(reportRoutes, /router\.get\('\/health',\s*isAdmin,/, 'health reports must be restricted to Admin');
assert.strictEqual((reportRoutes.match(/router\.get\('\/attendance'/g) || []).length, 1, 'attendance route must not be shadowed by a duplicate');
assert.strictEqual((reportRoutes.match(/router\.get\('\/staff'/g) || []).length, 1, 'staff route must not be shadowed by a duplicate');

console.log('Role access-control tests passed.');
