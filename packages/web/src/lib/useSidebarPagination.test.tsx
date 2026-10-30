import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useSidebarPagination } from './useSidebarPagination';

const observers: {
  callback: IntersectionObserverCallback;
  options?: IntersectionObserverInit | undefined;
  disconnect: () => void;
}[] = [];
function observePages() {
  observers.length = 0;
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      disconnect = vi.fn();
      constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
        observers.push({ callback, options, disconnect: this.disconnect });
      }
      observe() {}
    },
  );
}
function List({ active = -1, expanded = true, filter = '', count = 300 }) {
  const page = useSidebarPagination(count, active, expanded, filter);
  return (
    expanded && (
      <section ref={page.scrollRef} aria-label="Rows">
        {Array.from({ length: page.visibleCount }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: fixture row ids are stable and never reorder.
          <a key={i} href={`#${i}`} aria-current={active === i ? 'page' : undefined}>
            Row {i}
          </a>
        ))}
        {page.hasMore && <div ref={page.sentinelRef} aria-hidden="true" />}
      </section>
    )
  );
}
function intersect() {
  const observer = observers.at(-1);
  if (!observer) throw new Error('missing observer');
  act(() =>
    observer.callback(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    ),
  );
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('mounts 50 rows and observes the sentinel within its own list, then appends pages', () => {
  observePages();
  render(<List />);
  expect(screen.getAllByRole('link')).toHaveLength(50);
  expect(observers[0]?.options?.root).toBe(screen.getByRole('region', { name: 'Rows' }));
  intersect();
  expect(screen.getAllByRole('link')).toHaveLength(100);
  expect(observers[0]?.disconnect).toHaveBeenCalled();
  intersect();
  expect(screen.getAllByRole('link')).toHaveLength(150);
});

it('mounts and reveals a distant active row on navigation and after reopening', () => {
  observePages();
  const scroll = vi.spyOn(Element.prototype, 'scrollIntoView');
  const view = render(<List />);
  view.rerender(<List active={279} />);
  expect(screen.getAllByRole('link')).toHaveLength(300);
  expect(scroll.mock.instances.at(-1)).toBe(screen.getByRole('link', { name: 'Row 279' }));
  view.rerender(<List active={279} expanded={false} />);
  expect(screen.queryAllByRole('link')).toHaveLength(0);
  scroll.mockClear();
  view.rerender(<List active={279} />);
  expect(scroll).toHaveBeenCalledOnce();
});

it('restarts pagination when the filter changes', () => {
  observePages();
  const view = render(<List />);
  intersect();
  expect(screen.getAllByRole('link')).toHaveLength(100);
  view.rerender(<List filter="new" />);
  expect(screen.getAllByRole('link')).toHaveLength(50);
});

it('observes a new sentinel when a refetch grows an exact first page', () => {
  observePages();
  const view = render(<List count={50} />);
  expect(observers).toHaveLength(0);
  view.rerender(<List count={51} />);
  expect(observers).toHaveLength(1);
  intersect();
  expect(screen.getAllByRole('link')).toHaveLength(51);
});

it('keeps the active row visible when the other section changes its height', () => {
  const resized: ResizeObserverCallback[] = [];
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: ResizeObserverCallback) {
        resized.push(callback);
      }
      observe() {}
      disconnect() {}
    },
  );
  const scroll = vi.spyOn(Element.prototype, 'scrollIntoView');
  render(<List active={279} />);
  scroll.mockClear();
  act(() => {
    for (const callback of resized) callback([], {} as ResizeObserver);
  });
  expect(scroll).toHaveBeenCalledOnce();
  expect(scroll.mock.instances[0]).toBe(screen.getByRole('link', { name: 'Row 279' }));
});
