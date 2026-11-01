import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { HighlightColor } from '../../../lib/highlights';
import { SidebarControlContext } from '../../SidebarControlContext';
import type { ResolvedHighlight } from '../highlights/useHighlightLayer';
import type { HighlightsApi } from '../highlights/useHighlights';
import { NotesLane } from './NotesLane';
import type { Geometry } from './plan';
import type { Groups, NoteGroup } from './useGroups';
import type { NotesLaneApi } from './useNotesLane';

// A pane with room beside the column, a pane that needs a shift, and one with no room at all.
const ROOMY: Geometry = { left: 400, width: 636, proseRight: 1036, room: 1500 };
const SHIFT_HIDES_DIAL: Geometry = { left: 200, width: 636, proseRight: 836, room: 1000 };
const NARROW: Geometry = { left: 40, width: 600, proseRight: 640, room: 700 };
const WIDE: Geometry = { left: 100, width: 636, proseRight: 736, room: 940 };
let geometry: (delta: number) => Geometry;

vi.mock('./plan', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./plan')>()),
  measureGeometry: (_a: unknown, _p: unknown, _s: unknown, _applied: number, delta: number) =>
    geometry(delta),
}));
vi.mock('motion/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('motion/react')>()),
  useReducedMotion: () => true,
}));

const BLOCK = 40;
let restore: Array<() => void> = [];
/** Where the hovered block's top sits relative to its group's top, for the connector. */
let blockTop = 20;

function stub(proto: object, key: string, get: (this: HTMLElement) => unknown) {
  const original = Object.getOwnPropertyDescriptor(proto, key);
  Object.defineProperty(proto, key, { configurable: true, get });
  restore.push(() => {
    if (original) Object.defineProperty(proto, key, original);
    else Reflect.deleteProperty(proto, key);
  });
}

beforeEach(() => {
  restore = [];
  blockTop = 20;
  geometry = () => ROOMY;
  // Blocks are 40px tall, 48px apart; a group's scroller shows 112px of them.
  stub(HTMLElement.prototype, 'offsetHeight', function () {
    return this.classList.contains('silo-lnote') ? BLOCK : 0;
  });
  stub(HTMLElement.prototype, 'offsetTop', function () {
    return this.classList.contains('silo-lnote')
      ? Array.from(this.parentElement?.children ?? []).indexOf(this) * (BLOCK + 8)
      : 0;
  });
  stub(HTMLElement.prototype, 'clientHeight', function () {
    return this.classList.contains('silo-lgroup-scroll') ? 112 : 0;
  });
  stub(HTMLElement.prototype, 'scrollHeight', function () {
    return this.classList.contains('silo-lgroup-scroll')
      ? this.children.length * (BLOCK + 8) - 8
      : 0;
  });
  const original = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function () {
    const top = this.classList.contains('silo-lnote') ? blockTop : 0;
    return {
      top,
      bottom: top + BLOCK,
      left: 0,
      right: 0,
      width: 0,
      height: BLOCK,
      x: 0,
      y: top,
      toJSON() {},
    };
  };
  restore.push(() => {
    Element.prototype.getBoundingClientRect = original;
  });
});
afterEach(() => {
  cleanup();
  for (const undo of restore.reverse()) undo();
});

function found(id: string, color: HighlightColor = 'yellow'): ResolvedHighlight {
  return {
    id,
    color,
    start: 0,
    end: 1,
    how: 'offsets',
    range: Object.assign(document.createRange(), {
      getClientRects: () => [new DOMRect(0, 190, 100, 20)],
    }),
    highlight: {
      id,
      quote: `quote ${id}`,
      prefix: '',
      suffix: '',
      startOffset: 0,
      endOffset: 1,
      color,
      note: null,
      createdAt: '',
      updatedAt: '',
    },
  };
}

function group(para: number, ids: string[], top: number): NoteGroup {
  return {
    para,
    items: ids.map((id) => found(id)),
    y: top + 10,
    lineHeight: 28,
    top,
    paragraphHeight: 60,
  };
}

function lane(overrides: Partial<NotesLaneApi> = {}): NotesLaneApi {
  return {
    open: true,
    used: true,
    release: vi.fn(),
    toggle: vi.fn(),
    close: vi.fn(),
    focusIds: [],
    focus: vi.fn(),
    hoveredIds: [],
    setHoveredIds: vi.fn(),
    onMarker: vi.fn(),
    edit: vi.fn(),
    layers: null,
    closeLayers: vi.fn(),
    openFromLayers: vi.fn(),
    backTo: null,
    back: vi.fn(),
    closeNote: vi.fn(),
    ...overrides,
  };
}

type Setup = {
  groups?: NoteGroup[];
  lane?: Partial<NotesLaneApi>;
  sidebar?: { collapsed: boolean; freed: number };
};

function mount({ groups = [], lane: laneOverrides, sidebar }: Setup = {}) {
  document.body.innerHTML = '';
  const scroll = document.createElement('div');
  const article = document.createElement('article');
  article.className = 'silo-reader';
  const frame = document.createElement('div');
  const prose = document.createElement('div');
  frame.append(prose);
  article.append(frame);
  scroll.append(article);
  const host = document.createElement('div');
  const panel = document.createElement('div');
  frame.append(host);
  document.body.append(scroll, panel);
  const setCollapsed = vi.fn();
  const onDialHidden = vi.fn();
  const onOverlay = vi.fn();
  const api = {
    orphans: [],
    canWrite: true,
    resolved: groups.flatMap((g) => g.items),
    setNote: vi.fn(),
    remove: vi.fn(),
  };
  const listeners = new Set<() => void>();
  const current = { groups, frameTop: 0 };
  const all: Groups = {
    ...current,
    read: () => current,
    subscribe: (paint) => {
      listeners.add(paint);
      return () => {
        listeners.delete(paint);
      };
    },
  };
  const tree = (
    <SidebarControlContext.Provider
      value={{
        collapsed: sidebar?.collapsed ?? false,
        freedWidth: () => sidebar?.freed ?? 0,
        setCollapsed,
      }}
    >
      <NotesLane
        api={api as unknown as HighlightsApi}
        lane={lane(laneOverrides)}
        groups={all}
        prose={prose}
        scroll={scroll}
        host={host}
        panel={panel}
        gutterOffset={36}
        onDialHidden={onDialHidden}
        onOverlay={onOverlay}
      />
    </SidebarControlContext.Provider>
  );
  const view = render(tree);
  return {
    view,
    host,
    panel,
    scroll,
    frame,
    current,
    listeners,
    setCollapsed,
    onDialHidden,
    onOverlay,
  };
}

const tops = (host: HTMLElement) =>
  Array.from(host.querySelectorAll<HTMLElement>('.silo-lgroup')).map((el) => ({
    key: el.dataset.group,
    top: Number.parseFloat(el.style.top),
  }));

it('stacks crowded groups 12px apart, none overlapping, when the lane sits beside the column', () => {
  const { host } = mount({
    groups: [group(2, ['a', 'b', 'c'], 190), group(3, ['d', 'e', 'f'], 200), group(4, ['g'], 210)],
  });
  expect(host.querySelector('[data-notes-lane]')).not.toBeNull();
  // Three 40px blocks and two 8px gaps are 136px, capped at 112 beside a 60px paragraph.
  expect(tops(host)).toEqual([
    { key: 'p2', top: 188 },
    { key: 'p3', top: 188 + 112 + 12 },
    { key: 'p4', top: 188 + 112 + 12 + 112 + 12 },
  ]);
});

it('shows a +N chip for the blocks below a capped group fold and fades only the bottom', () => {
  const { host } = mount({ groups: [group(2, ['a', 'b', 'c'], 190), group(3, ['d'], 600)] });
  const first = host.querySelector('[data-group="p2"]') as HTMLElement;
  const chip = first.querySelector('.silo-lgroup-more');
  expect(chip?.textContent).toBe('+1');
  const scroller = first.querySelector('.silo-lgroup-scroll') as HTMLElement;
  expect(scroller.dataset.down).toBe('true');
  expect(scroller.dataset.up).toBe('false');
  const second = host.querySelector('[data-group="p3"]') as HTMLElement;
  expect(second.querySelector('.silo-lgroup-more')).toBeNull();
});

it('draws the connector to the hovered block and drops it when the block scrolls out of its group', () => {
  const { host } = mount({
    groups: [group(2, ['a', 'b', 'c'], 190)],
    lane: { hoveredIds: ['a'] },
  });
  const path = host.querySelector('.silo-hairline path') as SVGPathElement;
  expect(path.getAttribute('d')).toMatch(/^M\d/);
  expect(path.dataset.on).toBe('true');
  // The group scrolls inside itself and the block ends up above its top edge.
  blockTop = -60;
  fireEvent.scroll(host.querySelector('.silo-lgroup-scroll') as HTMLElement);
  expect(path.getAttribute('d')).toBe('');
  expect(path.dataset.on).toBe('false');
});

it('hides the outline dial while the shifted column would reach it, and shows it again on unmount', () => {
  geometry = () => SHIFT_HIDES_DIAL;
  const { view, onDialHidden } = mount({ groups: [group(2, ['a'], 190)] });
  expect(onDialHidden).toHaveBeenLastCalledWith(true);
  view.unmount();
  expect(onDialHidden).toHaveBeenLastCalledWith(false);
});

it('collapses the sidebar when that makes the lane fit and gives it back on unmount', async () => {
  geometry = (delta) => (delta > 0 ? WIDE : NARROW);
  const { view, setCollapsed } = mount({
    groups: [group(2, ['a'], 190)],
    sidebar: { collapsed: false, freed: 240 },
  });
  expect(setCollapsed).toHaveBeenCalledWith(true);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  view.unmount();
  expect(setCollapsed).toHaveBeenLastCalledWith(false);
});

it('turns into an overlay panel, leaving the sidebar alone, when the layout is a drawer', () => {
  geometry = () => NARROW;
  const { panel, host, setCollapsed, onOverlay } = mount({
    groups: [group(2, ['a'], 190)],
    sidebar: { collapsed: false, freed: 0 },
  });
  expect(setCollapsed).not.toHaveBeenCalled();
  expect(panel.querySelector('aside[data-notes-lane]')).not.toBeNull();
  expect(host.querySelector('.silo-lane')).toBeNull();
  expect(onOverlay).toHaveBeenLastCalledWith(true);
});

it('scrolls the reader to the emphasised group on the first docked open', () => {
  const scrollTo = vi.fn();
  stub(HTMLElement.prototype, 'scrollTo', () => scrollTo);
  mount({ groups: [group(2, ['a'], 190)], lane: { focusIds: ['a'] } });
  expect(scrollTo).toHaveBeenCalled();
  const call = scrollTo.mock.calls.find((args) => 'top' in (args[0] as object));
  expect((call?.[0] as { top: number }).top).toBe(188 - 0);
});

it('paints group reflow and the connector synchronously, before a React update', () => {
  const { host, current, listeners, frame } = mount({
    groups: [group(2, ['a'], 190), group(3, ['b'], 400)],
    lane: { hoveredIds: ['a'] },
  });
  expect(host.parentElement).toBe(frame);
  Object.assign(current.groups[0]?.items[0]?.range ?? {}, {
    getClientRects: () => [new DOMRect(0, 290, 100, 20)],
  });
  current.groups = [group(2, ['a'], 290), group(3, ['b'], 500)];
  blockTop = 30;
  // No act, timer, or animation frame is needed for these positions to reach the DOM.
  for (const paint of listeners) paint();
  expect(tops(host)).toEqual([
    { key: 'p2', top: 288 },
    { key: 'p3', top: 498 },
  ]);
  expect(host.querySelector('.silo-hairline path')?.getAttribute('d')).toBe(
    'M36 300C41 300 41 42 46 42',
  );
});
