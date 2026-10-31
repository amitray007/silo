import { beforeEach, describe, expect, it } from 'vitest';
import { buildTextMap, offsetsFromRange, rangeFromOffsets } from './textMap';

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

  it('leaves out code, figures, tables, controls and hidden text, like the pencil', () => {
    const map = buildTextMap(
      prose(
        '<p>Kept</p><pre>code</pre><figure><figcaption>cap</figcaption></figure>' +
          '<table><tr><td>cell</td></tr></table><p>also <button>Copy</button><span aria-hidden="true">x</span>kept</p>',
      ),
    );
    expect(map.text).toBe('Kept also kept');
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
    const map = buildTextMap(prose('<p>text</p><pre>code</pre>'));
    const outside = document.createElement('p');
    outside.textContent = 'elsewhere';
    document.body.append(outside);
    const range = document.createRange();
    range.selectNodeContents(outside);
    expect(offsetsFromRange(map, range)).toBeNull();
    const code = document.createRange();
    code.selectNodeContents(root.querySelector('pre') as Element);
    expect(offsetsFromRange(map, code)).toBeNull();
  });

  it('gives no range for an empty span', () => {
    const map = buildTextMap(prose('<p>text</p>'));
    expect(rangeFromOffsets(map, 2, 2)).toBeNull();
  });
});
