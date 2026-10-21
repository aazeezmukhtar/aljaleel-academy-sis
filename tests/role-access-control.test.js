'use strict';

// Recovery baseline checks only. These checks are intentionally static and do not
// import the database layer or modify any database.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const auth = fs.readFileSync(path.join(root, 'middleware', 'authMiddleware.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const fees = fs.readFileSync(path.join(root, 'routes', 'feeRoutes.js'), 'utf8');
const reports = fs.readFileSync(path.join(root, 'routes', 'reportRoutes.js'), 'utf8');
const auditController = fs.readFileSync(path.join(root, 'controllers', 'reportController.js'), 'utf8');
const sessionConfig = fs.readFileSync(path.join(root, 'utils', 'sessionSecret.js'), 'utf8');

assert.ok(auth.includes('isAuthenticated:'), 'staff authentication middleware should exist');
assert.ok(auth.includes('isAdmin:'), 'Admin middleware should exist');
assert.ok(auth.includes('isAdminOrBursar:'), 'finance role middleware should exist');
assert.ok(app.includes('secret: resolveSessionSecret()'), 'app must use validated session secret configuration');
assert.ok(sessionConfig.includes("env.NODE_ENV === 'production'"), 'session secret helper must validate production configuration');
assert.ok(sessionConfig.includes('SESSION_SECRET is required in production'), 'production must fail closed without SESSION_SECRET');
assert.ok(app.includes("app.use('/fees', isAuthenticated, feeRoutes)"), 'fee routes should remain behind staff authentication');
assert.ok(fees.includes("router.get('/setup', isAdminOrBursar"), 'fee setup must be restricted to finance roles');
assert.ok(fees.includes("router.post('/pay', isAdminOrBursar"), 'payment processing must be restricted to finance roles');
assert.ok(fees.includes("router.post('/setup/add', isAdminOrBursar"), 'adding fee categories must be restricted to finance roles');
assert.ok(fees.includes("router.post('/student/assign', isAdminOrBursar"), 'assigning charges must be restricted to finance roles');
assert.ok(fees.includes("router.get('/pay/:student_fee_id', isAdminOrBursar"), 'payment form must be restricted to finance roles');
assert.ok(fees.includes("router.get('/receipt/:receipt_number', isAdminOrBursar"), 'receipt access must be restricted to finance roles');
assert.ok(fees.includes("router.get('/manager', feeController.getFeeManager)"), 'existing manager route remains available for controller-level assigned-class checks');
assert.ok(reports.includes("router.get('/finance', isAdminOrBursar"), 'finance report dashboard must be restricted to finance roles');
assert.ok(reports.includes("router.get('/finance/status', isAdminOrBursar"), 'finance status report must be restricted to finance roles');
assert.ok(reports.includes("router.get('/finance/debtors', isAdminOrBursar"), 'debtors report must be restricted to finance roles');
assert.ok(reports.includes("router.get('/fees', isAdminOrBursar, reportController.getFeeReports)"), 'legacy fee report with financial totals must be restricted to finance roles');
assert.strictEqual((reports.match(/router.get\('\/attendance'/g) || []).length, 1, 'attendance dashboard route must be registered once');
assert.strictEqual((reports.match(/router.get\('\/staff'/g) || []).length, 1, 'staff dashboard route must be registered once');
assert.strictEqual((reports.match(/router.get\('\/health'/g) || []).length, 1, 'health dashboard route must be registered once');
assert.ok(reports.includes("router.get('/audit', isAdmin"), 'audit logs should remain Admin-only');
assert.ok(auditController.includes("res.render('settings/audit'"), 'audit logs should render the existing settings/audit view');

console.log('Recovery baseline checks passed (static only; no database accessed).');
