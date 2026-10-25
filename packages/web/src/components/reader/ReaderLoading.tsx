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

/** Keep an overlay for 200ms and until the actual frame/player load event. */
export function useFrameLoading(src: string) {
  const [loaded, setLoaded] = useState<string>();
  const [minimum, setMinimum] = useState<string>();
  useEffect(() => {
    const timer = setTimeout(() => setMinimum(src), 200);
    return () => clearTimeout(timer);
  }, [src]);
  return { loading: loaded !== src || minimum !== src, onLoad: () => setLoaded(src) };
}
