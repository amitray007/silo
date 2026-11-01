import { Component, lazy, type ReactNode, Suspense, useLayoutEffect, useState } from 'react';
import { useGutter } from '../gutter';
import type { HighlightsApi } from '../highlights/useHighlights';
import { GutterMarkers } from './GutterMarkers';
import { useGroups } from './useGroups';
import type { NotesLaneApi } from './useNotesLane';

// The lane brings the spring engine with it, so it loads the first time it opens.
const NotesLane = lazy(() =>
  import('./NotesLane').then((module) => ({ default: module.NotesLane })),
);

/** Catches a lane that fails to load or draw; the page stays up and the lane closes. */
class LaneBoundary extends Component<{ onFail: () => void; children: ReactNode }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch() {
    this.props.onFail();
  }
  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** A layer in the prose frame, beside the prose, that the lane and its connector draw in. */
function useScrollLayer(scroll: HTMLElement | null, wanted: boolean): HTMLElement | null {
  const [layer, setLayer] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (!scroll || !wanted) return;
    const el = document.createElement('div');
    el.className = 'silo-notes-layer';
    scroll.append(el);
    setLayer(el);
    return () => {
      el.remove();
      setLayer(null);
    };
  }, [scroll, wanted]);
  return layer;
}

/**
 * The note markers in the right gutter and, once opened, the notes lane. The dock mounts it with
 * the highlights; nothing here renders without a highlight (the markers) or an open lane.
 */
export function NotesLayer({
  api,
  lane,
  resumeY,
  panel,
  onDialHidden,
}: {
  api: HighlightsApi;
  lane: NotesLaneApi;
  /** The resume button's centre in the frame's coordinates, when there is one. */
  resumeY: number | null;
  panel: HTMLElement | null;
  onDialHidden: (hidden: boolean) => void;
}) {
  const { prose, scroll, resolved } = api;
  // Orphans need the lane's layout too, so an open lane measures even with nothing resolved.
  const groups = useGroups(prose, scroll, resolved, resolved.length > 0 || lane.open);
  const frame = prose?.parentElement ?? null;
  const gutter = useGutter();
  const [overlay, setOverlay] = useState(false);
  const layer = useScrollLayer(frame, lane.used);
  if (!prose || !scroll || !frame) return null;
  return (
    <>
      <GutterMarkers
        frame={frame}
        groups={groups}
        scroll={scroll}
        gutter={gutter}
        resumeY={resumeY}
        lane={lane}
        hidden={overlay}
      />
      {lane.used && layer && panel && (
        <LaneBoundary
          onFail={() => {
            lane.release();
            api.report("Couldn't open the notes lane");
          }}
        >
          <Suspense fallback={null}>
            <NotesLane
              api={api}
              lane={lane}
              groups={groups}
              prose={prose}
              scroll={scroll}
              host={layer}
              panel={panel}
              gutterOffset={gutter.gap + gutter.size + 6}
              onDialHidden={onDialHidden}
              onOverlay={setOverlay}
            />
          </Suspense>
        </LaneBoundary>
      )}
    </>
  );
}
