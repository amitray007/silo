import { render } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useIntersectionPrefetch } from './useIntersectionPrefetch';

/** A minimal `IntersectionObserver` stub — jsdom doesn't implement it. Records every instance so tests can drive `observe`/`disconnect` and fire intersections manually. */
class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  observed: Element[] = [];
  disconnected = false;
  constructor(
    public callback: IntersectionObserverCallback,
    public options?: IntersectionObserverInit,
  ) {
    FakeIntersectionObserver.instances.push(this);
  }
  observe(el: Element) {
    this.observed.push(el);
  }
  unobserve() {}
  disconnect() {
    this.disconnected = true;
  }
  takeRecords() {
    return [];
  }
  fire(isIntersecting: boolean) {
    this.callback(
      [{ isIntersecting } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
}

function Sentinel({ onCallback, enabled }: { onCallback: () => void; enabled: boolean }) {
  const ref = useIntersectionPrefetch(onCallback, { enabled });
  return createElement('div', { ref, 'data-testid': 'sentinel' });
}

describe('useIntersectionPrefetch', () => {
  beforeEach(() => {
    FakeIntersectionObserver.instances = [];
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('observes the sentinel and calls back exactly once per intersection', () => {
    const onCallback = vi.fn();
    render(createElement(Sentinel, { onCallback, enabled: true }));

    const observer = FakeIntersectionObserver.instances[0];
    expect(observer).toBeDefined();
    expect(observer?.observed).toHaveLength(1);

    observer?.fire(true);
    expect(onCallback).toHaveBeenCalledTimes(1);
  });

  it('does not call back on a non-intersecting entry', () => {
    const onCallback = vi.fn();
    render(createElement(Sentinel, { onCallback, enabled: true }));

    FakeIntersectionObserver.instances[0]?.fire(false);
    expect(onCallback).not.toHaveBeenCalled();
  });

  it('never creates an observer when disabled (e.g. already fetching, or no next page)', () => {
    const onCallback = vi.fn();
    render(createElement(Sentinel, { onCallback, enabled: false }));

    expect(FakeIntersectionObserver.instances).toHaveLength(0);
  });

  it('disconnects the observer when enabled flips to false', () => {
    const onCallback = vi.fn();
    const { rerender } = render(createElement(Sentinel, { onCallback, enabled: true }));

    const observer = FakeIntersectionObserver.instances[0];
    expect(observer?.disconnected).toBe(false);

    rerender(createElement(Sentinel, { onCallback, enabled: false }));
    expect(observer?.disconnected).toBe(true);
  });

  it('disconnects the observer on unmount', () => {
    const onCallback = vi.fn();
    const { unmount } = render(createElement(Sentinel, { onCallback, enabled: true }));

    const observer = FakeIntersectionObserver.instances[0];
    unmount();
    expect(observer?.disconnected).toBe(true);
  });

  it('applies a positive rootMargin so the prefetch fires before the foot', () => {
    const onCallback = vi.fn();
    render(createElement(Sentinel, { onCallback, enabled: true }));
    // The default warms the cache ~200px early (plan 010 — "before you reach the foot").
    expect(FakeIntersectionObserver.instances[0]?.options?.rootMargin).toBe('200px');
  });

  it('re-observes with a fresh observer after a fetch settles (enabled true→false→true)', () => {
    // The regression guard: after a prefetch fires and `enabled` flips false
    // (fetch in flight) then back true (fetch done, more pages), prefetch must
    // keep working — a NEW observer must be created and observe the sentinel,
    // else pagination silently dies after page 2.
    const onCallback = vi.fn();
    const { rerender } = render(createElement(Sentinel, { onCallback, enabled: true }));
    const first = FakeIntersectionObserver.instances[0];
    first?.fire(true);
    expect(onCallback).toHaveBeenCalledTimes(1);

    // fetch starts → enabled false → the first observer disconnects
    rerender(createElement(Sentinel, { onCallback, enabled: false }));
    expect(first?.disconnected).toBe(true);

    // fetch done, still has next page → enabled true → a fresh observer attaches
    rerender(createElement(Sentinel, { onCallback, enabled: true }));
    expect(FakeIntersectionObserver.instances).toHaveLength(2);
    const second = FakeIntersectionObserver.instances[1];
    expect(second).not.toBe(first);
    expect(second?.observed).toHaveLength(1);

    second?.fire(true);
    expect(onCallback).toHaveBeenCalledTimes(2);
  });
});
