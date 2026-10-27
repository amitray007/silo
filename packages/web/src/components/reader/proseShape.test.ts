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
