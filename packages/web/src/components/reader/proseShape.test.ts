import { describe, expect, it } from 'vitest';
import { shapeProse } from './proseShape';

function shape(html: string): string {
  const root = document.createElement('div');
  root.innerHTML = html;
  shapeProse(root);
  return root.innerHTML;
}

describe('shapeProse', () => {
  it('turns <br><br> runs and loose text around quotes into paragraphs', () => {
    expect(
      shape(
        'One <i>a</i>.<br> <br> Two: <blockquote> Quoted <i>x</i>. </blockquote> Three.<br><br><br>Four',
      ),
    ).toBe(
      '<p>One <i>a</i>.</p><p>Two:</p><blockquote><p>Quoted <i>x</i>.</p></blockquote><p>Three.</p><p>Four</p>',
    );
  });

  it('keeps single line breaks and already shaped prose as they are', () => {
    expect(shape('<p>Line<br>break</p><ul><li>a</li></ul>')).toBe(
      '<p>Line<br>break</p><ul><li>a</li></ul>',
    );
    expect(shape('Address line<br>Second line')).toBe('Address line<br>Second line');
  });

  it('marks quotes that already open with a quote mark', () => {
    expect(shape('<blockquote>“Said.”</blockquote>')).toBe(
      '<blockquote data-quoted="true"><p>“Said.”</p></blockquote>',
    );
    expect(shape('<blockquote><p>Plain.</p></blockquote>')).toBe(
      '<blockquote><p>Plain.</p></blockquote>',
    );
  });

  it('raises bracketed numeric links into footnote marks', () => {
    expect(shape('<p>Practitioners. [<a href="#f3n">3</a>] The other</p>')).toBe(
      '<p>Practitioners.<sup><a href="#f3n">3</a></sup> The other</p>',
    );
    expect(shape('<p>See [<a href="/x">docs</a>] here</p>')).toBe(
      '<p>See [<a href="/x">docs</a>] here</p>',
    );
  });
});

describe('shapeProse notes', () => {
  it('turns [n] note paragraphs into a linked footnote list', () => {
    expect(
      shape(
        'Body one. [<a href="https://x.test/e#f1n">1</a>] Body two. [<a href="https://x.test/e#f2n">2</a>]<br><br>' +
          '<b>Notes</b><br><br>[<a>1</a>] First note.<br><br>Still note one.<br><br>' +
          '[<a>2</a>] Second note.<br><br><b>Thanks</b> to readers.',
      ),
    ).toBe(
      '<p>Body one.<sup id="silo-fn-2"><a href="#silo-fn-1">1</a></sup> Body two.<sup id="silo-fn-4"><a href="#silo-fn-3">2</a></sup></p>' +
        '<p><b>Notes</b></p><ol>' +
        '<li id="silo-fn-1"><p>First note.</p><p>Still note one. <a href="#silo-fn-2" title="return to article">↩</a></p></li>' +
        '<li id="silo-fn-3"><p>Second note. <a href="#silo-fn-4" title="return to article">↩</a></p></li>' +
        '</ol><p><b>Thanks</b> to readers.</p>',
    );
  });

  it('leaves captures that already have footnotes and lone brackets alone', () => {
    const captured =
      '<p>Ref<sup id="silo-fn-1"><a href="#silo-fn-2">1</a></sup></p><p>[<a>1</a>] a</p><p>[<a>2</a>] b</p>';
    expect(shape(captured)).toContain('<p><sup><a>1</a></sup> a</p>');
    expect(shape('<p>[<a>1</a>] Only one note.</p>')).toBe(
      '<p><sup><a>1</a></sup> Only one note.</p>',
    );
  });
});
