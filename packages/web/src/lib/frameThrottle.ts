/**
 * Run `fn` at most once per animation frame, however often `run` is called. The callback runs
 * before the frame paints, so a layout it commits still lands in the same frame.
 */
export function frameThrottle(fn: () => void): { run: () => void; cancel: () => void } {
  let queued = false;
  let id = 0;
  return {
    run() {
      if (queued) return;
      queued = true;
      id = requestAnimationFrame(() => {
        queued = false;
        fn();
      });
    },
    cancel() {
      if (queued) cancelAnimationFrame(id);
      queued = false;
    },
  };
}
