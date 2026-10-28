import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReaderProse } from './ReaderProse';

const mermaid = vi.hoisted(() => ({ initialize: vi.fn(), render: vi.fn() }));
vi.mock('mermaid', () => ({ default: mermaid }));
beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    setTimeout(() => callback(0), 0),
  );
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
function reader(contentHtml: string) {
  return render(<ReaderProse linkId="rich" reader={{ contentHtml, contentImages: [] }} />);
}

it('highlights real JavaScript tokens and leaves unknown languages plain', async () => {
  const { container, unmount } = reader(
    '<pre><code data-lang="js">const answer = "&lt;script&gt;";</code></pre><pre><code data-lang="made-up">untouched</code></pre>',
  );
  await waitFor(() => expect(container.querySelector('code[data-highlighted]')).not.toBeNull(), {
    timeout: 10_000,
  });
  const known = container.querySelector('code[data-lang="js"]');
  expect(known?.textContent).toBe('const answer = "<script>";');
  expect(known?.querySelector('span')?.getAttribute('style')).toContain('var(--silo-code-');
  expect(known?.querySelector('script')).toBeNull();
  expect(container.querySelector('code[data-lang="made-up"]')?.innerHTML).toBe('untouched');
  expect(container.querySelector('.silo-reader-code-label')?.textContent).toBe('js');
  unmount();
});

it('uses strict Mermaid, sanitizes SVG, and keeps a keyboard-operable source disclosure', async () => {
  mermaid.render.mockResolvedValue({
    svg: '<svg xmlns="http://www.w3.org/2000/svg" onclick="evil()"><script>evil()</script><foreignObject><div>bad</div></foreignObject><rect width="20" height="20" onmouseover="evil()" style="stroke-dasharray: 5 5; fill:url(https://evil.test/a)"/><text>Safe label</text><a href="javascript:evil()">bad</a></svg>',
  });
  const { container, unmount } = reader(
    '<pre><code data-lang="mermaid">graph TD; A--&gt;B</code></pre>',
  );
  await waitFor(() => expect(container.querySelector('.silo-reader-diagram')).not.toBeNull());
  expect(mermaid.initialize).toHaveBeenCalledWith(
    expect.objectContaining({ securityLevel: 'strict', startOnLoad: false }),
  );
  const svg = container.querySelector('.silo-reader-diagram > svg');
  expect(svg?.textContent).toContain('Safe label');
  expect(svg?.querySelector('rect')?.getAttribute('style')).toContain('stroke-dasharray');
  expect(svg?.outerHTML).not.toContain('evil.test');
  expect(svg?.outerHTML).not.toMatch(/script|onclick|onmouseover|foreignObject|javascript:/i);
  const details = container.querySelector('details');
  expect(details?.querySelector('summary')?.textContent).toBe('Show source');
  expect(details?.querySelector('code')?.textContent).toBe('graph TD; A-->B');
  expect(details?.open).toBe(false);
  unmount();
});

it('retains source with a clear note when a diagram fails', async () => {
  mermaid.render.mockRejectedValue(new Error('bad diagram'));
  const { container, unmount } = reader(
    '<pre><code data-lang="mermaid">broken syntax</code></pre>',
  );
  await waitFor(() => expect(container.textContent).toContain('Diagram could not be rendered'));
  expect(container.querySelector('pre code')?.textContent).toBe('broken syntax');
  unmount();
});

it('does not decorate a replaced Reader after an async diagram resolves', async () => {
  let resolve: ((value: { svg: string }) => void) | undefined;
  mermaid.render.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const { container, rerender, unmount } = reader(
    '<pre><code data-lang="mermaid">graph TD; A-->B</code></pre>',
  );
  await waitFor(() => expect(resolve).toBeDefined());
  rerender(
    <ReaderProse linkId="new" reader={{ contentHtml: '<p>Next article</p>', contentImages: [] }} />,
  );
  resolve?.({ svg: '<svg><text>Old</text></svg>' });
  await new Promise((done) => setTimeout(done, 10));
  expect(container.textContent).toBe('Next article');
  expect(container.querySelector('svg')).toBeNull();
  unmount();
});

describe('callouts', () => {
  it.each(['note', 'info', 'tip', 'warning', 'danger', 'quote', 'custom'])(
    'renders %s with an existing icon and title',
    (type) => {
      const { container, unmount } = reader(
        `<blockquote data-callout="${type}" data-callout-title="Title &amp; details"><p>Body content</p></blockquote>`,
      );
      const callout = container.querySelector('[data-callout]');
      expect(callout?.getAttribute('data-callout-variant')).toBe(type === 'custom' ? 'note' : type);
      expect(callout?.querySelector('.silo-reader-callout-title')?.textContent).toBe(
        'Title & details',
      );
      expect(callout?.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
      expect(callout?.textContent).toContain('Body content');
      unmount();
    },
  );
});
