'use strict';

// Recovery baseline checks only. These checks are intentionally static and do not
// import the database layer or modify any database. They document the rolled-back
// application state before role protections are safely reintroduced.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const auth = fs.readFileSync(path.join(root, 'middleware', 'authMiddleware.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const fees = fs.readFileSync(path.join(root, 'routes', 'feeRoutes.js'), 'utf8');
const reports = fs.readFileSync(path.join(root, 'routes', 'reportRoutes.js'), 'utf8');
const auditController = fs.readFileSync(path.join(root, 'controllers', 'reportController.js'), 'utf8');

// The restored baseline must match the actual exported middleware and route state.
// These are baseline assertions, not a claim that all routes are adequately secured.
assert.match(auth, /isAuthenticated:\\s*\\(/, 'staff authentication middleware should exist');
assert.match(auth, /isAdmin:\\s*\\(/, 'Admin middleware should exist');
assert.doesNotMatch(auth, /isAdminOrBursar/, 'do not assume rolled-back finance middleware is active');
assert.match(app, /app\\.use\\('\\/fees',\\s*isAuthenticated,\\s*feeRoutes\\)/, 'fee routes should remain behind staff authentication');
assert.match(fees, /router\\.get\\('\\/setup'/, 'fee setup route should exist');
assert.match(fees, /router\\.post\\('\\/pay'/, 'payment route should exist');
assert.match(reports, /router\\.get\\('\\/audit',\\s*isAdmin,/, 'audit logs should remain Admin-only');
assert.match(auditController, /res\\.render\\('settings\\/audit'/, 'audit logs should render the existing settings/audit view');

console.log('Recovery baseline checks passed (static only; no database accessed).');
