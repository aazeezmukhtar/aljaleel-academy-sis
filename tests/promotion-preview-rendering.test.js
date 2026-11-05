'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');

const templatePath = path.join(__dirname, '..', 'views', 'settings', 'promotion.ejs');
const template = fs.readFileSync(templatePath, 'utf8');

// The full template must remain valid EJS after its responsive redesign.
assert.doesNotThrow(() => ejs.compile(template, { filename: templatePath }));

// Mobile-first class mapping and session controls.
assert.match(template, /promotion-session-grid/);
assert.match(template, /promotion-class-card/);
assert.match(template, /@media\s*\(max-width:\s*700px\)/);
assert.match(template, /grid-template-columns:\s*1fr/);
assert.match(template, /id="sourceSessionSelect"/);
assert.match(template, /id="targetSessionSelect"/);

// Changing the source session must preserve the currently selected destination.
assert.match(template, /targetSession = document\.getElementById\('targetSessionSelect'\)\.value/);
assert.match(template, /new URLSearchParams\(\{ source_session: newSession, target_session: targetSession \}\)/);

// Student selection is controllable globally and per source class.
assert.match(template, /data-group-select="all"/);
assert.match(template, /data-group-select="none"/);
assert.match(template, /setPromotionSelection\(true, group\.sourceClassId\)/);
assert.match(template, /setPromotionSelection\(false, group\.sourceClassId\)/);
assert.match(template, /updatePromotionCounts\(\)/);
assert.match(template, /Advancing to another class/);
assert.match(template, /Graduating \/ alumni/);
assert.match(template, /Repeating in current class/);

// Server-returned names and identifiers must be inserted as text, never HTML.
assert.match(template, /name\.textContent = student\.name/);
assert.match(template, /admission\.textContent = student\.admissionNumber/);
assert.match(template, /item\.textContent = message/);
assert.doesNotMatch(template, /previewContent\.innerHTML\s*=/);
assert.doesNotMatch(template, /innerHTML\s*=\s*`[\s\S]*?\$\{/,
    'Dynamic server values must not be interpolated into HTML strings');

// Review and commit must be separate, and commit remains disabled until a valid review exists.
assert.match(template, /id="promotionStatus"[^>]*role="status"[^>]*aria-live="polite"/);
assert.match(template, /id="commitBtn"[^>]*disabled/);
assert.match(template, /currentPromotionPreviewSignature !== getPromotionSignature\(\)/);
assert.match(template, /window\.confirm\(message\)/);
assert.match(template, /Processing session transition/);

console.log('Promotion preview rendering and responsive UI checks passed.');
