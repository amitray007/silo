import { render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ReaderProse } from './ReaderProse';

const modules = vi.hoisted(() => ({ highlight: vi.fn(), diagram: vi.fn() }));
vi.mock('./highlightCode', () => {
  modules.highlight();
  return { highlightCode: vi.fn() };
});
vi.mock('./renderDiagram', () => {
  modules.diagram();
  return { renderDiagram: vi.fn() };
});
afterEach(() => vi.unstubAllGlobals());
it.each([
  '<p>Only prose <code>inline</code></p><pre><code>plain block</code></pre>',
  '<pre><code data-lang="unsupported">unknown block</code></pre>',
])('does not import either heavy module for plain or unsupported blocks', (contentHtml) => {
  const schedule = vi.fn();
  vi.stubGlobal('requestAnimationFrame', schedule);
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  const { unmount } = render(
    <ReaderProse
      linkId="plain"
      reader={{
        contentHtml,
        contentImages: [],
      }}
    />,
  );
  expect(schedule).not.toHaveBeenCalled();
  expect(modules.highlight).not.toHaveBeenCalled();
  expect(modules.diagram).not.toHaveBeenCalled();
  unmount();
});
