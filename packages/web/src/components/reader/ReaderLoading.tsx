import { useEffect, useState } from 'react';

export function ReaderSkeleton({ label = 'Loading article' }: { label?: string }) {
  return (
    <div className="silo-reader-loading" role="status" aria-label={label}>
      <span className="silo-reader-hint">{label === 'Loading article' ? '' : label}</span>
      {[92, 84, 88, 60].map((width) => (
        <div key={width} className="silo-reader-skeleton" style={{ width: `${width}%` }} />
      ))}
    </div>
  );
}

/** Bound the opaque overlay even when a third-party frame never emits load. */
export function useFrameLoading(src: string) {
  const initial = { src, loaded: false, minimum: false, timedOut: false };
  const [progress, setProgress] = useState(initial);
  if (progress.src !== src) setProgress(initial);
  useEffect(() => {
    const minimum = setTimeout(
      () =>
        setProgress((current) => (current.src === src ? { ...current, minimum: true } : current)),
      200,
    );
    const deadline = setTimeout(
      () =>
        setProgress((current) =>
          current.src === src && !current.loaded ? { ...current, timedOut: true } : current,
        ),
      12_000,
    );
    return () => {
      clearTimeout(minimum);
      clearTimeout(deadline);
    };
  }, [src]);
  return {
    loading:
      progress.src !== src || (!progress.timedOut && (!progress.loaded || !progress.minimum)),
    timedOut: progress.src === src && progress.timedOut && !progress.loaded,
    onLoad: () =>
      setProgress((current) => (current.src === src ? { ...current, loaded: true } : current)),
  };
}

export function FrameLoadNotice({ href }: { href: string }) {
  return (
    <div className="silo-frame-notice" role="status">
      Still loading?{' '}
      <a href={href} target="_blank" rel="noopener noreferrer">
        Open in new tab
      </a>
    </div>
  );
}
