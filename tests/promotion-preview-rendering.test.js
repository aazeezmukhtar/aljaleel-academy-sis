'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const template = fs.readFileSync(path.join(__dirname, '..', 'views', 'settings', 'promotion.ejs'), 'utf8');
const helperMatch = template.match(/function escapePromotionPreviewHtml\(value\)\s*\{[\s\S]*?\n    \}/);
assert.ok(helperMatch, 'Promotion preview must define its HTML escaping helper');

// Exercise the exact helper source from the EJS template without a browser or database.
const escapeHtml = new Function(helperMatch[0] + '; return escapePromotionPreviewHtml;')();
assert.strictEqual(escapeHtml(`<script>alert("x")</script>`), '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
assert.strictEqual(escapeHtml(`O'Reilly & Sons`), 'O&#39;Reilly &amp; Sons');
assert.strictEqual(escapeHtml(null), '');
assert.strictEqual(escapeHtml(42), '42');

// Ensure every dynamic database/API value interpolated into the preview's HTML
// template is escaped before insertion.
for (const value of [
  'group.sourceClassName',
  'group.sectionName',
  'group.targetClassName',
  'group.studentCount',
  'source_session',
  'st.name',
  "st.admissionNumber || '#' + st.id"
]) {
  assert.ok(
    template.includes('${escapePromotionPreviewHtml(' + value + ')}'),
    'Preview interpolation must escape ' + value
  );
}
assert.ok(template.includes('previewContent.innerHTML = html;'), 'Preview rendering target should remain in place');
console.log('Promotion preview rendering security checks passed (escaping helper and all dynamic HTML interpolations).');
