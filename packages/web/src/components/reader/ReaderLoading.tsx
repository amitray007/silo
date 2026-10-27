import { useEffect, useState } from 'react';
import { deriveDomain } from '../../lib/url';
import { Chip } from '../Chip';

const articleParagraphs = [
  [97, 92, 95, 64],
  [94, 98, 89, 96, 52],
  [91, 86, 70],
];

/** Article-shaped lines with a moving sheen; the label is for screen readers only. */
export function ReaderSkeleton({ label = 'Loading article' }: { label?: string }) {
  return (
    <div className="silo-reader-loading" role="status" aria-label={label}>
      {articleParagraphs.map((lines) => (
        <div key={lines.join('-')} className="silo-reader-skeleton-paragraph" aria-hidden="true">
          {lines.map((width) => (
            <div key={width} className="silo-reader-skeleton" style={{ width: `${width}%` }} />
          ))}
        </div>
      ))}
    </div>
  );
}

const pageParagraphs = [
  [96, 91, 98, 62],
  [94, 88, 97, 70],
  [93, 85],
];

/** One page-shaped placeholder for both Original phases, so nothing swaps mid-load. */
export function PageSkeleton({ url, label }: { url: string; label: string }) {
  const domain = deriveDomain(url);
  return (
    <div className="silo-page-loading" role="status" aria-label={label}>
      <div className="silo-page-loading-bar" aria-hidden="true">
        <Chip domain={domain} size={16} />
        <span>{domain}</span>
        <span className="silo-page-loading-spinner" />
      </div>
      <div className="silo-page-loading-body" aria-hidden="true">
        <div className="silo-page-skel" data-kind="title" style={{ width: '74%' }} />
        <div className="silo-page-skel" data-kind="title" style={{ width: '46%' }} />
        <div className="silo-page-skel" data-kind="meta" />
        {pageParagraphs.map((lines) => (
          <div key={lines.join('-')} className="silo-page-skel-paragraph">
            {lines.map((width) => (
              <div key={width} className="silo-page-skel" style={{ width: `${width}%` }} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** A media-shaped placeholder that covers the player box until the embed loads. */
export function PlayerSkeleton() {
  return (
    <div className="silo-player-loading" role="status" aria-label="Loading player...">
      <span className="silo-page-loading-spinner" />
    </div>
  );
}

/** Bound the opaque overlay even when a third-party frame never emits load. */
export function useFrameLoading(src: string, minimumMs = 200) {
  const initial = { src, loaded: false, minimum: false, timedOut: false };
  const [progress, setProgress] = useState(initial);
  if (progress.src !== src) setProgress(initial);
  useEffect(() => {
    const minimum = setTimeout(
      () =>
        setProgress((current) => (current.src === src ? { ...current, minimum: true } : current)),
      minimumMs,
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
  }, [src, minimumMs]);
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
