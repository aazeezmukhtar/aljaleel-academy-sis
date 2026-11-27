(() => {
    'use strict';
    const allowedTags = new Set(['P', 'DIV', 'BR', 'STRONG', 'B', 'EM', 'I', 'U', 'UL', 'OL', 'LI']);
    const allowedAlign = new Set(['left', 'right', 'center', 'start', 'end']);

    function applyDirection(root) {
        root.setAttribute('dir', 'auto');
        root.querySelectorAll('p, div, li').forEach(block => block.setAttribute('dir', 'auto'));
    }

    function cleanNode(node, doc) {
        if (node.nodeType === Node.TEXT_NODE) return doc.createTextNode(node.nodeValue || '');
        if (node.nodeType !== Node.ELEMENT_NODE) return null;
        const tag = node.tagName.toUpperCase();
        if (!allowedTags.has(tag)) {
            const fragment = doc.createDocumentFragment();
            Array.from(node.childNodes).forEach(child => {
                const clean = cleanNode(child, doc);
                if (clean) fragment.appendChild(clean);
            });
            return fragment;
        }
        const cleanElement = doc.createElement(tag.toLowerCase());
        if (['P', 'DIV', 'LI'].includes(tag)) cleanElement.setAttribute('dir', 'auto');
        const style = node.style && node.style.textAlign;
        if (style && allowedAlign.has(style.toLowerCase())) cleanElement.style.textAlign = style.toLowerCase();
        Array.from(node.childNodes).forEach(child => {
            const clean = cleanNode(child, doc);
            if (clean) cleanElement.appendChild(clean);
        });
        return cleanElement;
    }

    function initialise(editor) {
        if (editor.dataset.richReady) return;
        editor.dataset.richReady = 'true';
        const form = editor.closest('form');
        const surface = editor.querySelector('[data-rich-editable]');
        const value = editor.querySelector('[data-rich-value]');
        if (!form || !surface || !value) return;

        editor.querySelectorAll('[data-command]').forEach(button => {
            button.addEventListener('mousedown', event => event.preventDefault());
            button.addEventListener('click', () => {
                surface.focus();
                document.execCommand(button.dataset.command, false, null);
                applyDirection(surface);
            });
        });

        surface.addEventListener('input', () => applyDirection(surface));
        surface.addEventListener('paste', () => window.setTimeout(() => applyDirection(surface), 0));
        form.addEventListener('submit', event => {
            const plain = surface.innerText.replace(/\u00a0/g, ' ').trim();
            if (!plain) {
                event.preventDefault();
                surface.focus();
                surface.setAttribute('aria-invalid', 'true');
                return;
            }
            surface.removeAttribute('aria-invalid');
            applyDirection(surface);
            const fragment = document.createDocumentFragment();
            Array.from(surface.childNodes).forEach(node => {
                const clean = cleanNode(node, document);
                if (clean) fragment.appendChild(clean);
            });
            const holder = document.createElement('div');
            holder.appendChild(fragment);
            value.value = holder.innerHTML;
        });
        applyDirection(surface);
    }

    function start() {
        document.querySelectorAll('[data-rich-editor]').forEach(initialise);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();
