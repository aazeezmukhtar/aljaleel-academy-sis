'use strict';

/**
 * Resolve the Express session secret.
 * Production must provide SESSION_SECRET through the deployment environment.
 * Development/test environments retain the legacy fallback for local usability.
 */
function resolveSessionSecret(env = process.env) {
  const configured = typeof env.SESSION_SECRET === 'string' ? env.SESSION_SECRET.trim() : '';
  if (configured) {
    if (configured.length < 32) {
      throw new Error('SESSION_SECRET must be at least 32 characters long.');
    }
    return configured;
  }

  if (env.NODE_ENV === 'production') {
    throw new Error('SESSION_SECRET is required in production. Configure it in the hosting environment before starting AcadMe.');
  }

  return 'nexus-sis-secret-key-offline-first';
}

module.exports = { resolveSessionSecret };
