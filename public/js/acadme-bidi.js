/* AcadMe bidirectional text support.
 * User-authored Arabic is automatically rendered RTL without mirroring English UI chrome.
 */
(() => {
  'use strict';
  const contentSelector = [
    '.announcement-content', '.acm-detail-title', '.acm-detail-body',
    '.announcement-title', '.assignment-title', '.post-title',
    '.acm-post-title', '.class-post-content', '.post-content',
    '[data-bidi-content]'
  ].join(',');
  const editableSelector = 'textarea,input[type="text"],input[type="search"],[contenteditable="true"]';
  const isArabic = value => /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(value || '');

  function orientEditable(element) {
    if (!(element instanceof HTMLElement)) return;
    const value = element.value ?? element.textContent ?? '';
    element.dir = isArabic(value) ? 'rtl' : 'ltr';
    element.style.textAlign = 'start';
    element.style.unicodeBidi = 'plaintext';
  }
  function orientContent(element) {
    if (!(element instanceof HTMLElement)) return;
    element.setAttribute('dir', 'auto');
    element.classList.add('acm-bidi-content');
  }
  function scan(root) {
    if (!(root instanceof Element || root instanceof Document)) return;
    if (root instanceof Element && root.matches(contentSelector)) orientContent(root);
    root.querySelectorAll?.(contentSelector).forEach(orientContent);
    if (root instanceof Element && root.matches(editableSelector)) orientEditable(root);
    root.querySelectorAll?.(editableSelector).forEach(orientEditable);
  }
  document.addEventListener('DOMContentLoaded', () => {
    scan(document);
    document.addEventListener('input', event => {
      if (event.target.matches(editableSelector)) orientEditable(event.target);
    });
    const observer = new MutationObserver(records => records.forEach(record => {
      record.addedNodes.forEach(node => {
        if (node.nodeType === Node.ELEMENT_NODE) scan(node);
      });
    }));
    observer.observe(document.body, { childList: true, subtree: true });
  });
})();
