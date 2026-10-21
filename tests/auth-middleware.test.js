'use strict';

// Unit tests for authentication/authorization middleware.
// Uses only synthetic request/response objects; no database or live service.
const assert = require('assert');
const { isAuthenticated, isAdmin, isAdminOrBursar } = require('../middleware/authMiddleware');

function response() {
  return {
    statusCode: 200,
    body: undefined,
    locals: {},
    redirectedTo: undefined,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    send(value) { this.body = value; return this; },
    redirect(path) { this.redirectedTo = path; return this; }
  };
}

function request(overrides = {}) {
  return {
    method: 'GET',
    headers: { accept: 'text/html' },
    session: {},
    ...overrides
  };
}

function invoke(middleware, req) {
  const res = response();
  let nextCalled = false;
  middleware(req, res, () => { nextCalled = true; });
  return { req, res, nextCalled };
}

// Anonymous page requests must go to login.
{
  const result = invoke(isAuthenticated, request());
  assert.strictEqual(result.res.redirectedTo, '/auth/login');
  assert.strictEqual(result.nextCalled, false);
}

// Anonymous API/non-GET requests must receive 401 instead of a redirect.
{
  const result = invoke(isAuthenticated, request({ method: 'POST' }));
  assert.strictEqual(result.res.statusCode, 401);
  assert.strictEqual(result.res.body.success, false);
  assert.strictEqual(result.nextCalled, false);
}

// Authenticated staff should continue and receive their school context.
{
  const result = invoke(isAuthenticated, request({
    session: { staff: { id: 7, role: 'Teacher', school_id: 1 } }
  }));
  assert.strictEqual(result.nextCalled, true);
  assert.strictEqual(result.req.schoolId, 1);
}

// Admin authorization must allow Admin and reject non-Admin staff.
{
  const allowed = invoke(isAdmin, request({
    session: { staff: { id: 1, role: 'Admin', school_id: 1 } }
  }));
  assert.strictEqual(allowed.nextCalled, true);
  assert.strictEqual(allowed.req.schoolId, 1);

  const denied = invoke(isAdmin, request({
    session: { staff: { id: 2, role: 'Teacher', school_id: 1 } }
  }));
  assert.strictEqual(denied.res.statusCode, 403);
  assert.strictEqual(denied.res.body, 'Access Denied: Admin Privileges Required');
  assert.strictEqual(denied.nextCalled, false);
}

// Finance authorization must allow Admin/Bursar and reject ordinary staff.
{
  for (const role of ['Admin', 'Bursar']) {
    const allowed = invoke(isAdminOrBursar, request({
      session: { staff: { id: 10, role, school_id: 1 } }
    }));
    assert.strictEqual(allowed.nextCalled, true, role + ' should access finance actions');
    assert.strictEqual(allowed.req.schoolId, 1);
  }

  const anonymous = invoke(isAdminOrBursar, request());
  assert.strictEqual(anonymous.res.statusCode, 403, 'anonymous requests must not enter finance handlers');
  assert.strictEqual(anonymous.nextCalled, false, 'anonymous requests must not reach finance handlers');

  const denied = invoke(isAdminOrBursar, request({
    session: { staff: { id: 11, role: 'Teacher', school_id: 1 } }
  }));
  assert.strictEqual(denied.res.statusCode, 403);
  assert.strictEqual(denied.res.body, 'Access Denied: Finance Privileges Required');
  assert.strictEqual(denied.nextCalled, false);
}

console.log('Authentication and finance authorization middleware tests passed (synthetic requests only).');
