/**
 * storageHelper.js
 * -----------------
 * Unified file-upload helper for Al-Jaleel Academy SIS.
 *
 * Production (Vercel + Supabase):
 *   Uploads the in-memory buffer directly to the Supabase Storage bucket
 *   "Uploads" and returns the public URL.  No local disk I/O at all.
 *
 * Development (no SUPABASE_URL env var):
 *   Writes the buffer to public/uploads/ and returns the relative path
 *   /uploads/<filename> so the rest of the views work exactly as before.
 *
 * Usage:
 *   const { uploadFile } = require('../utils/storageHelper');
 *   // req.file must come from multer({ storage: multer.memoryStorage() })
 *   const url = await uploadFile(req.file, 'students');
 *   // url → "/uploads/student-1234.jpg"  (dev)
 *   //      → "https://<project>.supabase.co/storage/v1/object/public/Uploads/students/student-1234.jpg" (prod)
 */

'use strict';

const fs   = require('fs');
const path = require('path');
require('dotenv').config();

// ---- Supabase client (lazy-initialised so it is only loaded when needed) ---
let _supabase = null;

function getSupabase() {
    if (_supabase) return _supabase;

    const url = process.env.SUPABASE_URL;
    // Prefer the service-role key (bypasses RLS), fall back to anon key
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY;

    if (!url || !key) return null;

    try {
        const { createClient } = require('@supabase/supabase-js');
        _supabase = createClient(url, key);
    } catch (e) {
        console.error('[storageHelper] Failed to create Supabase client:', e.message);
        return null;
    }
    return _supabase;
}

// Bucket name — Supabase lowercases bucket names
const BUCKET = 'uploads';

/**
 * Upload a multer in-memory file to Supabase Storage (prod) or local disk (dev).
 *
 * @param {import('multer').File} file  - multer file object (requires .buffer, .originalname, .mimetype)
 * @param {string} [folder='']          - optional sub-folder inside the bucket, e.g. "students"
 * @returns {Promise<string>}           - public URL (prod) or /uploads/<filename> path (dev)
 */
async function uploadFile(file, folder = '') {
    if (!file) return null;

    // Build a unique filename
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext          = path.extname(file.originalname);
    const baseName     = file.fieldname || 'file';
    const filename     = `${baseName}-${uniqueSuffix}${ext}`;

    const supabase = getSupabase();

    // ---- PRODUCTION PATH: upload to Supabase Storage ----------------------
    if (supabase) {
        const objectPath = folder ? `${folder}/${filename}` : filename;

        const { error } = await supabase.storage
            .from(BUCKET)
            .upload(objectPath, file.buffer, {
                contentType  : file.mimetype,
                cacheControl : '3600',
                upsert       : false
            });

        if (error) {
            console.error('[storageHelper] Supabase upload error:', error.message);
            throw new Error(`File upload failed: ${error.message}`);
        }

        const { data } = supabase.storage.from(BUCKET).getPublicUrl(objectPath);
        return data.publicUrl;
    }

    // ---- DEV PATH: write to public/uploads/ --------------------------------
    const uploadDir = path.join(__dirname, '..', 'public', 'uploads');
    if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
    }

    const destPath = path.join(uploadDir, filename);
    fs.writeFileSync(destPath, file.buffer);

    return `/uploads/${filename}`;
}

/**
 * Delete a file from Supabase Storage by its public URL or object path.
 * Silently fails if running locally (no-op) or if deletion fails.
 *
 * @param {string} urlOrPath - the value stored in the DB (public URL or /uploads/... path)
 */
async function deleteFile(urlOrPath) {
    if (!urlOrPath) return;

    const supabase = getSupabase();
    if (!supabase) return; // local dev — file on disk, skip

    try {
        const url = process.env.SUPABASE_URL;
        // Strip the bucket prefix to get the object path
        const bucketPrefix = `${url}/storage/v1/object/public/${BUCKET}/`;
        const objectPath   = urlOrPath.startsWith(bucketPrefix)
            ? urlOrPath.slice(bucketPrefix.length)
            : urlOrPath.replace(/^\/uploads\//, '');

        const { error } = await supabase.storage.from(BUCKET).remove([objectPath]);
        if (error) {
            console.warn('[storageHelper] Failed to delete file from Supabase:', error.message);
        }
    } catch (e) {
        console.warn('[storageHelper] deleteFile error:', e.message);
    }
}

module.exports = { uploadFile, deleteFile };
