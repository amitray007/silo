import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildTextMap,
  contextAfter,
  contextBefore,
  offsetsFromRange,
  rangeFromOffsets,
} from './textMap';

let root: HTMLElement;

function prose(html: string): HTMLElement {
  root = document.createElement('div');
  root.innerHTML = html;
  document.body.append(root);
  return root;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('buildTextMap', () => {
  it('collapses whitespace and joins blocks and line breaks with one space', () => {
    const map = buildTextMap(prose('<p>One   two\n three</p><p>Four</p><p>Five<br>six</p>'));
    expect(map.text).toBe('One two three Four Five six');
  });

  it('does not add a space inside a paragraph between inline elements', () => {
    const map = buildTextMap(prose('<p>Some <b>bold</b>text and <i>more</i></p>'));
    expect(map.text).toBe('Some boldtext and more');
  });

  it('keeps a space that sits between two inline elements', () => {
    const map = buildTextMap(prose('<p><b>a</b> <i>b</i></p>'));
    expect(map.text).toBe('a b');
  });

  it('keeps code, tables and captions, and leaves out hidden and non-text content', () => {
    const map = buildTextMap(
      prose(
        '<p>Kept</p><pre><code>let  x = 1;\nlet y</code></pre><figure><figcaption>cap</figcaption></figure>' +
          '<table><tr><td>cell</td><td>two</td></tr></table>' +
          '<p>also <button>Copy</button><span aria-hidden="true">x</span><svg><text>drawn</text></svg>kept</p>',
      ),
    );
    expect(map.text).toBe('Kept let x = 1; let y cap cell two also kept');
  });

  it('counts a skipped inline element as a word boundary', () => {
    expect(buildTextMap(prose('<p>left<svg></svg>right</p>')).text).toBe('left right');
    expect(buildTextMap(prose('<p>left<math><mi>x</mi></math>right</p>')).text).toBe('left right');
  });

  it('starts without a leading space and ends without a doubled one', () => {
    const map = buildTextMap(prose('  <p>  Start </p>  <p> end  </p> '));
    expect(map.text).toBe('Start end ');
  });
});

describe('offsets and ranges', () => {
  it('turns an offset span into a range over the same text', () => {
    const map = buildTextMap(prose('<p>Alpha beta</p><p>gamma delta</p>'));
    const start = map.text.indexOf('beta gamma');
    const range = rangeFromOffsets(map, start, start + 'beta gamma'.length);
    // jsdom's Range.toString adds no line break between paragraphs.
    expect(range?.toString()).toBe('betagamma');
    expect(range && offsetsFromRange(map, range)).toEqual({ start, end: start + 10 });
  });

  it('round-trips a DOM range back to offsets', () => {
    const map = buildTextMap(prose('<p>Alpha <b>beta</b> gamma</p><p>delta</p>'));
    const range = document.createRange();
    const bold = root.querySelector('b')?.firstChild as Text;
    const last = root.querySelectorAll('p')[1]?.firstChild as Text;
    range.setStart(bold, 1);
    range.setEnd(last, 3);
    const span = offsetsFromRange(map, range);
    expect(span && map.text.slice(span.start, span.end)).toBe('eta gamma del');
    const again = span && rangeFromOffsets(map, span.start, span.end);
    expect(again && offsetsFromRange(map, again)).toEqual(span);
  });

  it('handles a selection that starts and ends on element boundaries (triple click)', () => {
    const map = buildTextMap(prose('<p>First para</p><p>Second para</p><p>Third</p>'));
    const range = document.createRange();
    const paragraphs = root.querySelectorAll('p');
    range.setStart(paragraphs[0] as Element, 0);
    range.setEnd(paragraphs[1] as Element, 1);
    const span = offsetsFromRange(map, range);
    expect(span && map.text.slice(span.start, span.end)).toBe('First para Second para');
  });

  it('trims spaces at the edges of a selection', () => {
    const map = buildTextMap(prose('<p>one two three</p>'));
    const text = root.querySelector('p')?.firstChild as Text;
    const range = document.createRange();
    range.setStart(text, 3);
    range.setEnd(text, 8);
    const span = offsetsFromRange(map, range);
    expect(span && map.text.slice(span.start, span.end)).toBe('two');
  });

  it('returns null for a range outside the prose or without prose text', () => {
    const map = buildTextMap(prose('<p>text</p><button>go</button>'));
    const outside = document.createElement('p');
    outside.textContent = 'elsewhere';
    document.body.append(outside);
    const range = document.createRange();
    range.selectNodeContents(outside);
    expect(offsetsFromRange(map, range)).toBeNull();
    const hidden = document.createRange();
    hidden.selectNodeContents(root.querySelector('button') as Element);
    expect(offsetsFromRange(map, hidden)).toBeNull();
  });

  it('gives no range for an empty span', () => {
    const map = buildTextMap(prose('<p>text</p>'));
    expect(rangeFromOffsets(map, 2, 2)).toBeNull();
  });
});

describe('whitespace-only nodes at an element boundary', () => {
  it('maps a triple click, which ends at the next block, without a negative offset', () => {
    const map = buildTextMap(prose('<div>\n  <p>First para</p>\n  <p>Second para</p>\n</div>'));
    const start = document.createRange();
    start.setStart(root.firstChild as Node, 0);
    start.setEnd(root.querySelectorAll('p')[1] as Element, 0);
    expect(offsetsFromRange(map, start)).toEqual({ start: 0, end: 'First para'.length });
    const all = document.createRange();
    all.selectNodeContents(root);
    expect(offsetsFromRange(map, all)).toEqual({ start: 0, end: map.text.trimEnd().length });
  });
});

describe('context cuts', () => {
  it('does not split a surrogate pair', () => {
    const text = `a\u{1F600}${'b'.repeat(63)}needle${'c'.repeat(63)}\u{1F600}`;
    const at = text.indexOf('needle');
    const lone = /(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])/;
    expect(contextBefore(text, at, 64)).not.toMatch(lone);
    expect(contextAfter(text, at + 6, 64)).not.toMatch(lone);
    expect(contextBefore('short', 3, 64)).toBe('sho');
    expect(contextAfter('short', 2, 64)).toBe('ort');
  });
});

describe('shared normaliser fixture', () => {
  const cases = JSON.parse(
    readFileSync(
      resolve(process.cwd(), 'src/components/reader/highlights/normalise.fixture.json'),
      'utf8',
    ),
  ) as Array<{ name: string; text: string; expected: string }>;

  it.each(cases)('$name matches the server collapse', ({ text, expected }) => {
    const p = document.createElement('p');
    p.textContent = text;
    document.body.append(p);
    expect(buildTextMap(p).text.trim()).toBe(expected);
  });
});
