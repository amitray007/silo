import { apiUrl } from '../../api/client';
import type { LinkJson } from '../../api/types';
import { FrameLoadNotice, PageSkeleton, useFrameLoading } from './ReaderLoading';
import { ReaderPlayer } from './ReaderPlayer';
import type { OriginalState } from './useOriginal';
import { originalUrl } from './useReaderActions';

function PageFrame({ src, silo, url }: { src: string; silo: boolean; url: string }) {
  const { loading, timedOut, onLoad } = useFrameLoading(src);
  return (
    <div className="silo-original-surface" aria-busy={loading}>
      <iframe
        title={silo ? 'Silo view' : 'Live page'}
        sandbox={silo ? 'allow-popups allow-popups-to-escape-sandbox' : undefined}
        className="silo-original-frame"
        src={src}
        referrerPolicy="no-referrer"
        onLoad={onLoad}
      />
      {timedOut && <FrameLoadNotice href={url} />}
      {loading && (
        <div className="silo-frame-loading">
          <PageSkeleton url={url} label="Loading page..." />
        </div>
      )}
    </div>
  );
}

export function Original({ link, state }: { link: LinkJson; state: OriginalState }) {
  const { mode, preparing, embed, reload } = state;
  return (
    <div className="silo-original" data-mode={mode}>
      {preparing ? (
        <PageSkeleton url={link.url} label="Preparing page..." />
      ) : embed ? (
        <div className="silo-original-player">
          <ReaderPlayer key={reload} embed={embed} url={link.url} fill />
        </div>
      ) : mode === 'direct' || mode === 'view' ? (
        <PageFrame
          key={`${mode}-${reload}`}
          url={link.url}
          silo={mode === 'view'}
          src={
            mode === 'view'
              ? apiUrl(`/api/links/${encodeURIComponent(link.id)}/view?reload=${reload}`)
              : (originalUrl(link.url) ?? '')
          }
        />
      ) : (
        <div className="silo-original-card">
          <h2>{link.title || link.url}</h2>
          <p>{link.description || 'This content cannot be displayed here.'}</p>
        </div>
      )}
    </div>
  );
}
