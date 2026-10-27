import {
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import {
  actualScale,
  clampView,
  clickScale,
  FIT,
  fitSize,
  maxScale,
  type Point,
  type Size,
  type View,
  zoomAt,
} from '../../lib/imageZoom';
import { trapDialogTab } from '../ModalShell';
import { ReaderIcon } from './ReaderIcon';

export type ViewerImage = { src: string; alt: string; caption: string; href: string };

const STEP = 1.5;
/** Movement beyond this many pixels makes a press a drag, not a click. */
const TAP_SLOP = 4;

type Geometry = { natural: Size; stage: Size; fitted: Size; max: number };

function useStageSize(stageRef: RefObject<HTMLDivElement | null>): Size {
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measure = () => setSize({ width: stage.clientWidth, height: stage.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [stageRef]);
  return size;
}

/** Offset of a client point from the stage center, the origin `View` uses. */
function stagePoint(stage: HTMLElement, clientX: number, clientY: number): Point {
  const box = stage.getBoundingClientRect();
  return { x: clientX - box.left - box.width / 2, y: clientY - box.top - box.height / 2 };
}

/**
 * Wheel and Safari gesture listeners must be non-passive to stop page zoom and
 * scroll, so they are attached natively. Pinch (ctrl or ⌘ wheel) zooms at the
 * pointer; a plain wheel pans a zoomed image, as in PhotoSwipe and macOS Preview.
 */
function useWheelZoom(
  stageRef: RefObject<HTMLDivElement | null>,
  geometry: Geometry,
  setView: (update: (view: View) => View) => void,
  setGesture: (active: boolean) => void,
) {
  const latest = useRef(geometry);
  latest.current = geometry;
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    let settle = 0;
    let gestureScale = 1;
    const active = () => {
      setGesture(true);
      window.clearTimeout(settle);
      settle = window.setTimeout(() => setGesture(false), 120);
    };
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const { fitted, stage: size, max } = latest.current;
      active();
      if (event.ctrlKey || event.metaKey) {
        const point = stagePoint(stage, event.clientX, event.clientY);
        const factor = Math.exp(-event.deltaY * (event.deltaMode === 1 ? 0.05 : 0.01));
        setView((view) => zoomAt(view, view.scale * factor, point, fitted, size, max));
      } else {
        setView((view) =>
          view.scale === 1
            ? view
            : clampView(
                { ...view, x: view.x - event.deltaX, y: view.y - event.deltaY },
                fitted,
                size,
                max,
              ),
        );
      }
    };
    // Safari reports trackpad pinch as gesture events instead of ctrl+wheel.
    const gestureStart = (event: Event) => {
      event.preventDefault();
      gestureScale = 1;
    };
    const gestureChange = (event: Event) => {
      event.preventDefault();
      const gesture = event as Event & { scale: number; clientX: number; clientY: number };
      const { fitted, stage: size, max } = latest.current;
      const point = stagePoint(stage, gesture.clientX, gesture.clientY);
      const factor = gesture.scale / gestureScale;
      gestureScale = gesture.scale;
      active();
      setView((view) => zoomAt(view, view.scale * factor, point, fitted, size, max));
    };
    stage.addEventListener('wheel', wheel, { passive: false });
    stage.addEventListener('gesturestart', gestureStart);
    stage.addEventListener('gesturechange', gestureChange);
    return () => {
      window.clearTimeout(settle);
      stage.removeEventListener('wheel', wheel);
      stage.removeEventListener('gesturestart', gestureStart);
      stage.removeEventListener('gesturechange', gestureChange);
    };
  }, [stageRef, setView, setGesture]);
}

type Press = {
  start: View;
  origin: Point;
  moved: boolean;
  onImage: boolean;
  pinch?: { distance: number; center: Point };
};

/** Drag pans a zoomed image, two fingers pinch, and a still press is a click. */
function usePointerGestures(
  stageRef: RefObject<HTMLDivElement | null>,
  geometry: Geometry,
  view: View,
  setView: (next: View | ((view: View) => View)) => void,
  setGesture: (active: boolean) => void,
  onBackdrop: () => void,
) {
  const pointers = useRef(new Map<number, Point>());
  const press = useRef<Press | null>(null);
  const latestView = useRef(view);
  latestView.current = view;

  const begin = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const stage = stageRef.current;
    if (!stage) return;
    stage.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const points = [...pointers.current.values()];
    const onImage = (event.target as Element).tagName === 'IMG';
    if (points.length === 2) {
      const [a, b] = points as [Point, Point];
      const center = stagePoint(stage, (a.x + b.x) / 2, (a.y + b.y) / 2);
      press.current = {
        start: view,
        origin: center,
        moved: true,
        onImage,
        pinch: { distance: Math.hypot(a.x - b.x, a.y - b.y), center },
      };
    } else
      press.current = {
        start: view,
        origin: { x: event.clientX, y: event.clientY },
        moved: false,
        onImage,
      };
  };

  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    const stage = stageRef.current;
    const current = press.current;
    if (!stage || !current || !pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const { fitted, stage: size, max } = geometry;
    const points = [...pointers.current.values()];
    if (current.pinch && points.length === 2) {
      const [a, b] = points as [Point, Point];
      const center = stagePoint(stage, (a.x + b.x) / 2, (a.y + b.y) / 2);
      const scale =
        current.start.scale * (Math.hypot(a.x - b.x, a.y - b.y) / current.pinch.distance);
      const zoomed = zoomAt(current.start, scale, current.pinch.center, fitted, size, max);
      setGesture(true);
      setView(
        clampView(
          {
            ...zoomed,
            x: zoomed.x + center.x - current.pinch.center.x,
            y: zoomed.y + center.y - current.pinch.center.y,
          },
          fitted,
          size,
          max,
        ),
      );
      return;
    }
    const dx = event.clientX - current.origin.x;
    const dy = event.clientY - current.origin.y;
    if (!current.moved && Math.hypot(dx, dy) > TAP_SLOP) current.moved = true;
    if (!current.moved || current.start.scale === 1) return;
    setGesture(true);
    setView(
      clampView(
        { ...current.start, x: current.start.x + dx, y: current.start.y + dy },
        fitted,
        size,
        max,
      ),
    );
  };

  const end = (event: ReactPointerEvent<HTMLDivElement>) => {
    const stage = stageRef.current;
    const current = press.current;
    pointers.current.delete(event.pointerId);
    if (pointers.current.size > 0) {
      // After a pinch, the finger left down pans from the view the pinch ended on.
      const [rest] = pointers.current.values();
      if (current?.pinch && rest)
        press.current = {
          start: latestView.current,
          origin: rest,
          moved: true,
          onImage: current.onImage,
        };
      return;
    }
    press.current = null;
    setGesture(false);
    if (!stage || !current || current.moved || event.type === 'pointercancel') return;
    if (!current.onImage) {
      onBackdrop();
      return;
    }
    const { natural, fitted, stage: size, max } = geometry;
    const point = stagePoint(stage, event.clientX, event.clientY);
    setView((latest) =>
      latest.scale > 1
        ? FIT
        : zoomAt(latest, clickScale(natural, fitted, max), point, fitted, size, max),
    );
  };

  return { onPointerDown: begin, onPointerMove: move, onPointerUp: end, onPointerCancel: end };
}

function useViewerKeys(
  dialogRef: RefObject<HTMLDivElement | null>,
  actions: {
    close: () => void;
    step: (delta: number) => void;
    zoom: (factor: number) => void;
    reset: () => void;
  },
) {
  const latest = useRef(actions);
  latest.current = actions;
  useEffect(() => {
    // Window capture runs before the app's shortcuts, which must not act behind the viewer.
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Tab' || !dialogRef.current) return;
      event.stopPropagation();
      const { close, step, zoom, reset } = latest.current;
      const handlers: Record<string, () => void> = {
        Escape: close,
        ArrowLeft: () => step(-1),
        ArrowRight: () => step(1),
        '+': () => zoom(STEP),
        '=': () => zoom(STEP),
        '-': () => zoom(1 / STEP),
        '0': reset,
      };
      const handler = handlers[event.key];
      if (!handler || event.metaKey || event.ctrlKey || event.altKey) return;
      event.preventDefault();
      handler();
    };
    window.addEventListener('keydown', keydown, true);
    return () => window.removeEventListener('keydown', keydown, true);
  }, [dialogRef]);
}

/** Full-screen image view with zoom and pan, opened from Reader article images. */
export function ImageViewer({
  images,
  index,
  onStep,
  onClose,
}: {
  images: ViewerImage[];
  index: number;
  /** Move by `delta` images, wrapping; the owner applies it to its latest index. */
  onStep: (delta: number) => void;
  onClose: () => void;
}) {
  const image = images[index] as ViewerImage;
  const dialogRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const stage = useStageSize(stageRef);
  const [natural, setNatural] = useState<Size>({ width: 0, height: 0 });
  const [view, setViewState] = useState<View>(FIT);
  const [gesture, setGesture] = useState(false);
  const fitted = fitSize(natural, stage);
  const max = maxScale(natural, fitted);
  const geometry: Geometry = { natural, stage, fitted, max };
  const setView = useCallback((next: View | ((view: View) => View)) => setViewState(next), []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new image starts at the fitted size.
  useLayoutEffect(() => {
    setViewState(FIT);
    const element = imageRef.current;
    setNatural(
      element?.complete && element.naturalWidth
        ? { width: element.naturalWidth, height: element.naturalHeight }
        : { width: 0, height: 0 },
    );
  }, [image.src]);

  useEffect(() => {
    const trigger = document.activeElement;
    dialogRef.current?.focus();
    return () => {
      if (trigger instanceof HTMLElement && document.contains(trigger)) trigger.focus();
    };
  }, []);

  const step = (delta: number) => {
    if (images.length > 1) onStep(delta);
  };
  const zoom = (factor: number) =>
    setView((latest) => zoomAt(latest, latest.scale * factor, { x: 0, y: 0 }, fitted, stage, max));
  const reset = () => setView(FIT);
  useViewerKeys(dialogRef, { close: onClose, step, zoom, reset });
  useWheelZoom(stageRef, geometry, setView, setGesture);
  const pointer = usePointerGestures(stageRef, geometry, view, setView, setGesture, onClose);

  const percent = Math.round((view.scale / actualScale(natural, fitted)) * 100);
  const zoomed = view.scale > 1;
  return createPortal(
    <div
      ref={dialogRef}
      className="silo-viewer"
      role="dialog"
      aria-modal="true"
      aria-label={image.alt ? `Image: ${image.alt}` : 'Image viewer'}
      tabIndex={-1}
      onKeyDown={trapDialogTab}
    >
      <div className="silo-viewer-bar">
        <span className="silo-viewer-count">
          {images.length > 1 ? `${index + 1} / ${images.length}` : ''}
        </span>
        <div className="silo-viewer-tools">
          <button
            type="button"
            className="silo-viewer-button"
            aria-label="Zoom out"
            disabled={!zoomed}
            onClick={() => zoom(1 / STEP)}
          >
            <ReaderIcon name="minus" />
          </button>
          <button
            type="button"
            className="silo-viewer-zoom"
            aria-label="Fit to screen"
            title="Fit to screen (0)"
            onClick={reset}
          >
            {natural.width ? `${percent}%` : ''}
          </button>
          <button
            type="button"
            className="silo-viewer-button"
            aria-label="Zoom in"
            disabled={view.scale >= max}
            onClick={() => zoom(STEP)}
          >
            <ReaderIcon name="plus" />
          </button>
          <a
            className="silo-viewer-button"
            href={image.href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Open in new tab"
          >
            <ReaderIcon name="external" />
          </a>
          <button type="button" className="silo-viewer-button" aria-label="Close" onClick={onClose}>
            <ReaderIcon name="close" />
          </button>
        </div>
      </div>
      <div
        ref={stageRef}
        className="silo-viewer-stage"
        data-zoomed={zoomed}
        data-gesture={gesture}
        {...pointer}
      >
        <img
          ref={imageRef}
          key={image.src}
          src={image.src}
          alt={image.alt}
          draggable={false}
          onLoad={(event) =>
            setNatural({
              width: event.currentTarget.naturalWidth,
              height: event.currentTarget.naturalHeight,
            })
          }
          style={{
            width: fitted.width || undefined,
            height: fitted.height || undefined,
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
          }}
        />
      </div>
      {images.length > 1 && (
        <>
          <button
            type="button"
            className="silo-viewer-nav"
            data-side="previous"
            aria-label="Previous image"
            onClick={() => step(-1)}
          >
            <ReaderIcon name="back" />
          </button>
          <button
            type="button"
            className="silo-viewer-nav"
            data-side="next"
            aria-label="Next image"
            onClick={() => step(1)}
          >
            <ReaderIcon name="right" />
          </button>
        </>
      )}
      {image.caption && <p className="silo-viewer-caption">{image.caption}</p>}
    </div>,
    document.body,
  );
}
