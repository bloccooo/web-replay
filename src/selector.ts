/**
 * Builds a unique CSS selector or XPath for an element.
 * Run inside page.evaluate() — no Puppeteer types here.
 */
export const buildSelectorScript = `
function buildSelector(el) {
  if (!el || el === document.body) return null;

  // 1. data-testid
  const testId = el.getAttribute('data-testid');
  if (testId) return '[data-testid="' + testId + '"]';

  // 2. id
  if (el.id) {
    const byId = '#' + CSS.escape(el.id);
    if (document.querySelectorAll(byId).length === 1) return byId;
  }

  // 3. name attribute (inputs)
  const name = el.getAttribute('name');
  if (name) {
    const byName = el.tagName.toLowerCase() + '[name="' + name + '"]';
    if (document.querySelectorAll(byName).length === 1) return byName;
  }

  // 4. Walk up, building a path
  function getIndex(node) {
    let i = 1;
    let sib = node.previousElementSibling;
    while (sib) {
      if (sib.tagName === node.tagName) i++;
      sib = sib.previousElementSibling;
    }
    return i;
  }

  const parts = [];
  let current = el;
  while (current && current !== document.body && parts.length < 6) {
    const tag = current.tagName.toLowerCase();
    const idx = getIndex(current);
    parts.unshift(idx > 1 ? tag + ':nth-of-type(' + idx + ')' : tag);
    const selector = parts.join(' > ');
    if (document.querySelectorAll(selector).length === 1) return selector;
    current = current.parentElement;
  }

  return parts.join(' > ');
}

function buildXPath(el) {
  if (!el || el === document.body) return null;
  const parts = [];
  let current = el;
  while (current && current.nodeType === Node.ELEMENT_NODE) {
    const tag = current.tagName.toLowerCase();
    let idx = 1;
    let sib = current.previousElementSibling;
    while (sib) {
      if (sib.tagName === current.tagName) idx++;
      sib = sib.previousElementSibling;
    }
    parts.unshift(tag + '[' + idx + ']');
    current = current.parentElement;
  }
  return '/' + parts.join('/');
}
`;

/**
 * Script injected on replay to resolve a selector to an element.
 * Returns { x, y, found } where x/y are the element's center in viewport coords.
 */
export const resolveElementScript = `
function resolveElement(selector, xpath) {
  let el = null;
  if (selector) {
    try { el = document.querySelector(selector); } catch {}
  }
  if (!el && xpath) {
    try {
      const result = document.evaluate(xpath, document, null,
        XPathResult.FIRST_ORDERED_NODE_TYPE, null);
      el = result.singleNodeValue;
    } catch {}
  }
  return el;
}

function elementCenter(el) {
  const r = el.getBoundingClientRect();
  return {
    x: Math.round(r.left + r.width / 2),
    y: Math.round(r.top + r.height / 2),
  };
}
`;
