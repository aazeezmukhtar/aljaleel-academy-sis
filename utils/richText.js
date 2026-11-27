'use strict';

// Allowlist sanitizer for teacher-authored announcement and class-board content.
// No attributes survive except a narrowly validated text alignment and text direction.
const ALLOWED_TAGS = new Set(['p', 'div', 'br', 'strong', 'b', 'em', 'i', 'u', 'ul', 'ol', 'li']);

function decodeEntities(value) {
    const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };
    return String(value).replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match, entity) => {
        if (entity[0] !== '#') return named[entity.toLowerCase()] || match;
        const hex = entity[1].toLowerCase() === 'x';
        const code = parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
            ? String.fromCodePoint(code) : '\uFFFD';
    });
}

function escapeText(value) {
    return decodeEntities(value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function safeAttributes(tag, rawAttributes) {
    if (!['p', 'div', 'li'].includes(tag)) return '';
    const attrs = [];
    const dir = rawAttributes.match(/\bdir\s*=\s*["']?(auto|ltr|rtl)["']?/i);
    if (dir) attrs.push('dir="' + dir[1].toLowerCase() + '"');
    const align = rawAttributes.match(/\bstyle\s*=\s*["'][^"']*text-align\s*:\s*(left|right|center|start|end)\s*;?[^"']*["']/i);
    if (align) {
        const value = align[1].toLowerCase();
        attrs.push('style="text-align:' + value + '"');
    }
    return attrs.length ? ' ' + attrs.join(' ') : '';
}

function sanitizeRichText(input) {
    const source = String(input == null ? '' : input);
    if (!source) return '';
    const tokenPattern = /<!--[^]*?-->|<\/?([a-z][a-z0-9]*)([^<>]*)>/gi;
    const stack = [];
    let output = '';
    let cursor = 0;
    let match;

    const closeTop = () => { output += '</' + stack.pop() + '>'; };
    while ((match = tokenPattern.exec(source))) {
        output += escapeText(source.slice(cursor, match.index)).replace(/\r\n?/g, '\n').replace(/\n/g, '<br>');
        cursor = tokenPattern.lastIndex;
        if (match[0].startsWith('<!--')) continue;

        const tag = match[1].toLowerCase();
        if (!ALLOWED_TAGS.has(tag)) continue;
        const closing = /^<\//.test(match[0]);
        if (tag === 'br') {
            if (!closing) output += '<br>';
            continue;
        }
        if (closing) {
            const index = stack.lastIndexOf(tag);
            if (index !== -1) while (stack.length > index) closeTop();
            continue;
        }
        output += '<' + tag + safeAttributes(tag, match[2] || '') + '>';
        stack.push(tag);
    }
    output += escapeText(source.slice(cursor)).replace(/\r\n?/g, '\n').replace(/\n/g, '<br>');
    while (stack.length) closeTop();
    return output;
}

module.exports = { sanitizeRichText };
