/** Image viewer geometry. Offsets are from the stage center; scale 1 is the fitted size. */
export type Size = { width: number; height: number };
export type Point = { x: number; y: number };
export type View = { scale: number; x: number; y: number };

export const FIT: View = { scale: 1, x: 0, y: 0 };
/** Room around a fitted image for the toolbar and side arrows; phones keep the width. */
function stagePadding(stage: Size): number {
  return stage.width < 640 ? 12 : 56;
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/** The largest size that fits the stage without upscaling past the image's own pixels. */
export function fitSize(natural: Size, stage: Size, padding = stagePadding(stage)): Size {
  if (!natural.width || !natural.height) return { width: 0, height: 0 };
  const ratio = Math.min(
    1,
    Math.max(1, stage.width - padding * 2) / natural.width,
    Math.max(1, stage.height - padding * 2) / natural.height,
  );
  return { width: natural.width * ratio, height: natural.height * ratio };
}

/** Scale where one image pixel meets one screen pixel. */
export function actualScale(natural: Size, fitted: Size): number {
  return fitted.width ? natural.width / fitted.width : 1;
}

/** Zoom far enough to read fine print: 4x the fit, or 2x actual size for large images. */
export function maxScale(natural: Size, fitted: Size): number {
  return clamp(Math.max(4, actualScale(natural, fitted) * 2), 4, 16);
}

/** Keep the image covering the stage once it is larger than it; center it when smaller. */
export function clampView(view: View, fitted: Size, stage: Size, max: number): View {
  const scale = clamp(view.scale, 1, max);
  const limitX = Math.max(0, (fitted.width * scale - stage.width) / 2);
  const limitY = Math.max(0, (fitted.height * scale - stage.height) / 2);
  return {
    scale,
    x: clamp(view.x, -limitX, limitX),
    y: clamp(view.y, -limitY, limitY),
  };
}

/** Change scale while the image point under `point` stays under it. */
export function zoomAt(
  view: View,
  scale: number,
  point: Point,
  fitted: Size,
  stage: Size,
  max: number,
): View {
  const next = clamp(scale, 1, max);
  const ratio = next / view.scale;
  return clampView(
    {
      scale: next,
      x: point.x - (point.x - view.x) * ratio,
      y: point.y - (point.y - view.y) * ratio,
    },
    fitted,
    stage,
    max,
  );
}

/** A click zooms to actual size when that is a real step up, otherwise to 2.5x. */
export function clickScale(natural: Size, fitted: Size, max: number): number {
  const actual = actualScale(natural, fitted);
  return Math.min(max, actual >= 1.5 ? actual : 2.5);
}
