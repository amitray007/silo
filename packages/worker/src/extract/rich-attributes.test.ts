import { JSDOM } from 'jsdom';
import { expect, it } from 'vitest';
import { sanitizeReaderContent } from './reader-content.js';

const cases = [
  ['code', 'data-lang', 'TypeScript', 'typescript'],
  ['code', 'data-lang', 'c++', 'c++'],
  ['code', 'data-lang', 'c#', 'c#'],
  ['code', 'data-lang', 'a'.repeat(24), 'a'.repeat(24)],
  ['code', 'data-lang', 'a'.repeat(25), null],
  ['code', 'data-lang', 'js onclick=evil', null],
  ['code', 'data-lang', '../js', null],
  ['code', 'data-lang', '', null],
  ['pre', 'data-lang', 'js', null],
  ['p', 'data-lang', 'js', null],
  ['div', 'data-callout', 'note', 'note'],
  ['blockquote', 'data-callout', 'custom-type', 'custom-type'],
  ['div', 'data-callout', 'a'.repeat(20), 'a'.repeat(20)],
  ['div', 'data-callout', 'a'.repeat(21), null],
  ['div', 'data-callout', 'NOTE', null],
  ['div', 'data-callout', 'note warning', null],
  ['div', 'data-callout', 'url(evil)', null],
  ['div', 'data-callout', '', null],
  ['code', 'data-callout', 'note', null],
  ['p', 'data-callout', 'note', null],
  ['div', 'data-callout-title', 'A safe title & details', 'A safe title & details'],
  ['blockquote', 'data-callout-title', 'é'.repeat(200), 'é'.repeat(200)],
  ['div', 'data-callout-title', 'a'.repeat(201), null],
  ['div', 'data-callout-title', '<img onerror=evil>', null],
  ['div', 'data-callout-title', 'bad\nvalue', null],
  ['p', 'data-callout-title', 'Title', null],
  ['code', 'data-callout-title', 'Title', null],
] as const;

it.each(cases)('allowlist: %s %s %s', (tag, name, value, expected) => {
  const dom = new JSDOM();
  try {
    const node = dom.window.document.createElement(tag);
    node.textContent = 'Body';
    node.setAttribute(name, value);
    const result = sanitizeReaderContent(node.outerHTML, 'https://example.com');
    dom.window.document.body.innerHTML = result?.contentHtml ?? '';
    expect(dom.window.document.querySelector(tag)?.getAttribute(name)).toBe(expected);
  } finally {
    dom.window.close();
  }
});
