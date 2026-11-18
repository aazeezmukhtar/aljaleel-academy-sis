'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const directory = fs.readFileSync(path.join(root, 'views/students/index.ejs'), 'utf8');
const routes = fs.readFileSync(path.join(root, 'routes/studentRoutes.js'), 'utf8');
const controller = fs.readFileSync(path.join(root, 'controllers/bulkStudentController.js'), 'utf8');

// The directory no longer advertises the legacy bulk-import workflow.
assert.doesNotMatch(directory, /href=["']\/students\/bulk-import["']/,
  'Student directory must not expose a Bulk Import link');

// Keep both admin-protected endpoints and their controller handlers intact for
// authorized administrators who already know the legacy URL.
assert.match(routes, /router\.get\('\/bulk-import',\s*isAdmin,\s*bulkStudentController\.getBulkImportPage\)/,
  'Legacy bulk-import page route must remain Admin-protected');
assert.match(routes, /router\.post\('\/bulk-import',\s*isAdmin,\s*bulkUpload\.single\('studentFile'\),\s*bulkStudentController\.processBulkImport\)/,
  'Legacy bulk-import action route must remain Admin-protected');
assert.match(controller, /const getBulkImportPage\s*=/);
assert.match(controller, /const processBulkImport\s*=/);

console.log('[bulk-import-visibility] Directory link hidden; protected legacy routes and handlers preserved.');
