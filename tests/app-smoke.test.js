'use strict';

// Starts the application against the disposable CI SQLite fixture only.
// Verifies the HTTP entry points without logging in or touching production services.
const assert = require('assert');
const { spawn } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const port = 4178;
const baseUrl = 'http://127.0.0.1:' + port;

const child = spawn(process.execPath, [path.join(root, 'app.js')], {
  cwd: root,
  env: {
    ...process.env,
    NODE_ENV: 'test',
    PORT: String(port),
    DB_TYPE: 'sqlite',
    DB_PATH: process.env.DB_PATH || '.test-database.sqlite',
    SESSION_SECRET: 'ci-only-session-secret-that-is-long-enough-123456'
  },
  stdio: ['ignore', 'pipe', 'pipe']
});

let output = '';
child.stdout.on('data', chunk => { output += chunk.toString(); });
child.stderr.on('data', chunk => { output += chunk.toString(); });

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForServer() {
  let lastError;
  for (let attempt = 0; attempt < 30; attempt++) {
    if (child.exitCode !== null) {
      throw new Error('Application exited before becoming ready. Output:\n' + output);
    }
    try {
      const response = await fetch(baseUrl + '/', { redirect: 'manual' });
      return response;
    } catch (error) {
      lastError = error;
      await delay(300);
    }
  }
  throw new Error('Application did not become ready: ' + (lastError && lastError.message) + '\n' + output);
}

(async () => {
  try {
    const home = await waitForServer();
    assert.strictEqual(home.status, 302, 'root route should redirect to staff login');
    assert.strictEqual(home.headers.get('location'), '/auth/login', 'root route should target /auth/login');

    const login = await fetch(baseUrl + '/auth/login');
    assert.strictEqual(login.status, 200, 'staff login page should render successfully');
    const html = await login.text();
    assert.ok(/<form/i.test(html), 'staff login page should contain a form');

    console.log('Application HTTP smoke test passed: root redirect and staff login page respond.');
  } catch (error) {
    console.error('Application HTTP smoke test failed:', error.message);
    process.exitCode = 1;
  } finally {
    child.kill('SIGTERM');
    await delay(200);
  }
})();
