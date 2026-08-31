/**
 * utils/tenantHelper.js
 * Centralized Server-Side Tenant Resolution & Context Management
 * 
 * Provides safe, cached tenant retrieval by slug or ID without hardcoding school IDs.
 */

const db = require('./db');

// In-memory cache for fast tenant resolution across requests (TTL: 5 minutes)
const tenantCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Normalizes a slug or domain string
 * @param {string} slug 
 * @returns {string}
 */
function normalizeSlug(slug) {
    if (!slug) return '';
    return slug.trim().toLowerCase();
}

/**
 * Retrieves a school/tenant record by its human-readable slug.
 * @param {string} slug 
 * @returns {Promise<Object|null>}
 */
async function getTenantBySlug(slug) {
    const cleanSlug = normalizeSlug(slug);
    if (!cleanSlug) return null;

    const cacheKey = `slug:${cleanSlug}`;
    const cached = tenantCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < CACHE_TTL_MS)) {
        return cached.data;
    }

    try {
        const school = await db.get(
            'SELECT * FROM schools WHERE LOWER(slug) = LOWER(?) AND status != \'archived\'',
            [cleanSlug]
        );

        if (school) {
            tenantCache.set(cacheKey, { data: school, timestamp: Date.now() });
            tenantCache.set(`id:${school.id}`, { data: school, timestamp: Date.now() });
        }
        return school || null;
    } catch (err) {
        console.error(`[TenantHelper] Error fetching tenant by slug "${cleanSlug}":`, err.message);
        return null;
    }
}

/**
 * Retrieves a school/tenant record by its immutable internal ID.
 * @param {number|string} id 
 * @returns {Promise<Object|null>}
 */
async function getTenantById(id) {
    const numericId = parseInt(id, 10);
    if (!numericId) return null;

    const cacheKey = `id:${numericId}`;
    const cached = tenantCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < CACHE_TTL_MS)) {
        return cached.data;
    }

    try {
        const school = await db.get(
            'SELECT * FROM schools WHERE id = ? AND status != \'archived\'',
            [numericId]
        );

        if (school) {
            tenantCache.set(cacheKey, { data: school, timestamp: Date.now() });
            if (school.slug) {
                tenantCache.set(`slug:${school.slug.toLowerCase()}`, { data: school, timestamp: Date.now() });
            }
        }
        return school || null;
    } catch (err) {
        console.error(`[TenantHelper] Error fetching tenant by id "${numericId}":`, err.message);
        return null;
    }
}

/**
 * Retrieves the default active tenant (used for legacy fallback during transition).
 * Never hardcodes ID = 1; dynamically finds the primary active tenant (ordered by id ASC).
 * @returns {Promise<Object|null>}
 */
async function getDefaultTenant() {
    const cacheKey = 'default:primary';
    const cached = tenantCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < CACHE_TTL_MS)) {
        return cached.data;
    }

    try {
        const school = await db.get(
            'SELECT * FROM schools WHERE status = \'active\' ORDER BY id ASC LIMIT 1'
        );

        if (school) {
            tenantCache.set(cacheKey, { data: school, timestamp: Date.now() });
        }
        return school || null;
    } catch (err) {
        console.error('[TenantHelper] Error fetching default tenant:', err.message);
        return null;
    }
}

/**
 * Clears the in-memory tenant cache (e.g. after branding or settings updates)
 */
function clearTenantCache() {
    tenantCache.clear();
}

module.exports = {
    getTenantBySlug,
    getTenantById,
    getDefaultTenant,
    clearTenantCache,
    normalizeSlug
};
