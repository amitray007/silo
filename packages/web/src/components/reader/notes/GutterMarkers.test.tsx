import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ResolvedHighlight } from '../highlights/useHighlightLayer';
import { GutterMarkers } from './GutterMarkers';
import { useGroups } from './useGroups';
import type { NotesLaneApi } from './useNotesLane';

let scroll: HTMLElement;
let frame: HTMLElement;
let prose: HTMLElement;
let resolved: ResolvedHighlight[];
let x: number;
let y: number;
let width: number;
let observers: {
  elements: Set<Element>;
  paint: () => void;
  disconnect: ReturnType<typeof vi.fn>;
}[];

beforeEach(() => {
  x = 0;
  y = 0;
  width = 320;
  observers = [];
  vi.stubGlobal(
    'ResizeObserver',
    class {
      elements = new Set<Element>();
      disconnect = vi.fn();
      constructor(paint: () => void) {
        observers.push({ elements: this.elements, paint, disconnect: this.disconnect });
      }
      observe(element: Element) {
        this.elements.add(element);
      }
    },
  );
  scroll = document.createElement('div');
  frame = document.createElement('div');
  prose = document.createElement('div');
  prose.innerHTML = '<p>First paragraph.</p><p>Second paragraph.</p>';
  frame.append(prose);
  scroll.append(frame);
  document.body.append(scroll);
  vi.spyOn(frame, 'clientWidth', 'get').mockImplementation(() => width);
  vi.spyOn(scroll, 'clientWidth', 'get').mockReturnValue(800);
  vi.spyOn(frame, 'getBoundingClientRect').mockImplementation(
    () => new DOMRect(100 + x, 50 + y, width, 800),
  );
  vi.spyOn(scroll, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 800, 800));
  resolved = [...prose.children].map((paragraph, i) => {
    (paragraph as HTMLElement).style.lineHeight = '28px';
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    vi.spyOn(paragraph, 'getBoundingClientRect').mockImplementation(
      () => new DOMRect(100 + x, 100 + y + i * 100, width, 80),
    );
    Object.assign(range, {
      getClientRects: () => [new DOMRect(100 + x, 104 + y + i * 100, 100, 20)],
    });
    return { id: `h${i}`, range } as ResolvedHighlight;
  });
});
afterEach(() => {
  cleanup();
  scroll.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function Markers({ resumeY = null }: { resumeY?: number | null }) {
  const groups = useGroups(prose, scroll, resolved, true);
  return (
    <GutterMarkers
      frame={frame}
      scroll={scroll}
      groups={groups}
      gutter={{ size: 24, gap: 6, edge: 4 }}
      resumeY={resumeY}
      lane={{ focusIds: [] } as unknown as NotesLaneApi}
      hidden={false}
    />
  );
}

it('paints current marker coordinates inside the resize callback and disconnects on unmount', () => {
  const view = render(<Markers />);
  const markers = [...frame.querySelectorAll<HTMLElement>('.silo-marker')];
  expect(markers.map((m) => m.style.top)).toEqual(['52px', '152px']);
  expect(markers[0]?.style.left).toBe('326px');
  const observer = observers.find((o) => o.elements.has(prose));
  expect(observer?.elements.has(prose.children[0] as Element)).toBe(true);
  width = 240;
  y = 100;
  // Moving the frame and every paragraph together does not change their relative y.
  observer?.paint();
  expect(markers.map((m) => m.style.top)).toEqual(['52px', '152px']);
  expect(markers[0]?.style.left).toBe('246px');
  Object.assign(resolved[1]?.range ?? {}, {
    getClientRects: () => [new DOMRect(100, 434, 100, 20)],
  });
  observer?.paint();
  expect(markers[1]?.style.top).toBe('282px');
  view.unmount();
  expect(observer?.disconnect).toHaveBeenCalledOnce();
});

it('keeps whole-line resume clearance and clamps the gutter when the pane is narrow', () => {
  render(<Markers resumeY={64} />);
  const marker = frame.querySelector<HTMLElement>('.silo-marker');
  expect(marker?.style.top).toBe('80px');
  x = 500;
  observers.find((o) => o.elements.has(prose))?.paint();
  expect(marker?.style.left).toBe('172px');
  expect(marker?.style.top).toBe('80px');
});
