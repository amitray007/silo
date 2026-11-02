import { act, renderHook } from '@testing-library/react';
import { type ReactNode, useCallback, useMemo, useState } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { SidebarControlContext } from '../../SidebarControlContext';
import type { Geometry } from './plan';
import { useColumnShift } from './useColumnShift';

const NARROW: Geometry = { left: 40, width: 600, proseRight: 640, room: 700 };
const WIDE: Geometry = { left: 100, width: 636, proseRight: 736, room: 940 };
const FITS: Geometry = { left: 400, width: 636, proseRight: 1036, room: 1500 };
let geometry: (delta: number) => Geometry;
/** Replaces the sidebar-driven geometry when a test needs a fixed layout. */
let fixed: Geometry | null;

vi.mock('./plan', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./plan')>()),
  measureGeometry: (_a: unknown, _p: unknown, _s: unknown, _applied: number, delta: number) =>
    geometry(delta),
}));

let article: HTMLElement;
let prose: HTMLElement;
let scroll: HTMLElement;
let calls: boolean[];
/** Starts the sidebar collapsed or open, as the reader's saved choice. */
let startCollapsed = false;
let expand: (() => void) | null;
let contract: (() => void) | null;

function Sidebar({ children }: { children: ReactNode }) {
  const [collapsed, set] = useState(startCollapsed);
  const setCollapsed = useCallback((next: boolean) => {
    calls.push(next);
    set(next);
  }, []);
  expand = () => set(false);
  contract = () => set(true);
  const value = useMemo(
    () => ({ collapsed, setCollapsed, freedWidth: () => (collapsed ? 0 : 240) }),
    [collapsed, setCollapsed],
  );
  // The layout the geometry stub reports follows the sidebar.
  geometry = (delta) => fixed ?? (delta > 0 || collapsed ? WIDE : NARROW);
  return <SidebarControlContext.Provider value={value}>{children}</SidebarControlContext.Provider>;
}

let anchor: () => Element | null = () => null;

function setup(open: boolean) {
  return renderHook(
    ({ open: isOpen }) =>
      useColumnShift({
        prose,
        scroll,
        open: isOpen,
        anchor: () => anchor(),
        reduced: true,
        onDialHidden: () => {},
      }),
    { initialProps: { open }, wrapper: Sidebar },
  );
}

beforeEach(() => {
  calls = [];
  startCollapsed = false;
  expand = null;
  contract = null;
  fixed = null;
  anchor = () => null;
  document.body.innerHTML =
    '<div class="scroll"><article class="silo-reader"><div><div class="prose"></div></div></article></div>';
  scroll = document.querySelector('.scroll') as HTMLElement;
  article = document.querySelector('.silo-reader') as HTMLElement;
  prose = document.querySelector('.prose') as HTMLElement;
});

it('collapses the app sidebar when that makes the lane fit, and restores it on close', async () => {
  const view = setup(false);
  expect(view.result.current.stacked).toBe(false);
  view.rerender({ open: true });
  expect(calls).toEqual([true]);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 60));
  });
  expect(view.result.current.stacked).toBe(true);
  expect(view.result.current.overlay).toBe(false);
  expect(article.style.transform).toMatch(/translateX\(-\d+px\)/);
  view.rerender({ open: false });
  expect(calls).toEqual([true, false]);
  expect(article.style.transform).toBe('');
});

it('leaves the sidebar alone when the reader had already collapsed it', () => {
  startCollapsed = true;
  const view = setup(true);
  view.rerender({ open: false });
  expect(calls).toEqual([]);
});

it('shows an overlay panel, and never touches the sidebar, when collapsing would not help', () => {
  fixed = NARROW;
  const view = setup(true);
  expect(view.result.current.overlay).toBe(true);
  expect(view.result.current.stacked).toBe(false);
  expect(calls).toEqual([]);
});

it('moves the column without collapsing anything when the lane fits after a shift', () => {
  fixed = FITS;
  const view = setup(true);
  expect(calls).toEqual([]);
  expect(view.result.current.stacked).toBe(true);
});

it('does not collapse the sidebar again after the reader opens it during the lane', async () => {
  const view = setup(false);
  view.rerender({ open: true });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 60));
  });
  expect(calls).toEqual([true]);
  act(() => expand?.());
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 60));
  });
  expect(calls).toEqual([true]);
  expect(view.result.current.overlay).toBe(true);
  view.rerender({ open: false });
  expect(calls).toEqual([true]);
});

it('keeps a scroll made while the lane is open when the layout changes later', async () => {
  const paragraph = document.createElement('p');
  prose.append(paragraph);
  // The paragraph sits 300px down at scrollTop 100 and moves up as the reader scrolls.
  paragraph.getBoundingClientRect = () => {
    const top = 400 - scroll.scrollTop;
    return { top, bottom: top + 20, left: 0, right: 0, width: 0, height: 20 } as DOMRect;
  };
  anchor = () => paragraph;
  fixed = { ...WIDE, room: 1000, proseRight: 836, left: 200 };
  scroll.scrollTop = 100;
  setup(true);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 60));
  });
  // The reader scrolls on, then something resizes the pane.
  scroll.scrollTop = 500;
  fixed = { ...WIDE, room: 1100, proseRight: 836, left: 200 };
  act(() => contract?.());
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 60));
  });
  expect(scroll.scrollTop).toBe(500);
});
