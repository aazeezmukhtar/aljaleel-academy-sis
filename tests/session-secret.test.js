'use strict';

const assert = require('assert');
const { resolveSessionSecret } = require('../utils/sessionSecret');

assert.throws(
  () => resolveSessionSecret({ NODE_ENV: 'production' }),
  /SESSION_SECRET is required in production/,
  'production must not silently use a predictable fallback'
);

assert.throws(
  () => resolveSessionSecret({ NODE_ENV: 'production', SESSION_SECRET: 'too-short' }),
  /at least 32 characters/,
  'production secrets must meet the minimum length'
);

const configured = 'test-only-session-secret-that-is-long-enough-123';
assert.strictEqual(
  resolveSessionSecret({ NODE_ENV: 'production', SESSION_SECRET: configured }),
  configured,
  'a configured production secret should be accepted'
);

assert.strictEqual(
  resolveSessionSecret({ NODE_ENV: 'test' }),
  'nexus-sis-secret-key-offline-first',
  'local test environments should preserve the legacy fallback'
);

console.log('Session secret configuration unit tests passed.');
