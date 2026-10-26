import type { CSSProperties } from 'react';
import { apiUrl } from '../../api/client';
import type { LinkJson } from '../../api/types';
import { FrameLoadNotice, PageSkeleton, useFrameLoading } from './ReaderLoading';
import { ReaderPlayer } from './ReaderPlayer';
import type { OriginalState } from './useOriginal';
import { originalUrl } from './useReaderActions';

function fallbackReason(reason: string | undefined): string {
  if (reason === 'needs-script') return 'This page needs its own scripts to display.';
  if (
    [
      'fetch-error',
      'dns-error',
      'timeout',
      'http-error',
      'not-found',
      'too-many-redirects',
      'body-too-large',
    ].includes(reason ?? '')
  )
    return 'Silo could not load this page.';
  return 'This content cannot be displayed here.';
}

function pageTheme(state: OriginalState): CSSProperties {
  if (state.theme !== 'dark') return {};
  if (!state.darkPage) return { colorScheme: 'light' };
  if (state.mode !== 'direct' || state.darkTheme !== false) return {};
  return { filter: 'invert(0.9) hue-rotate(180deg)', backgroundColor: 'white' };
}

function PageSurface({ link, state, showReader }: OriginalProps) {
  const { mode, preparing, reload } = state;
  const { loading, timedOut, onLoad } = useFrameLoading(`${link.id}-${link.url}-${reload}`, 0);
  const framed = mode === 'direct' || mode === 'view';
  const busy = loading && (preparing || framed);
  return (
    <div className="silo-original-surface" aria-busy={busy}>
      {framed && (
        <iframe
          key={`${mode}-${reload}`}
          title={mode === 'view' ? 'Silo view' : 'Live page'}
          sandbox={
            mode === 'view'
              ? 'allow-popups allow-popups-to-escape-sandbox'
              : 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-presentation'
          }
          className="silo-original-frame"
          src={
            mode === 'view'
              ? apiUrl(`/api/links/${encodeURIComponent(link.id)}/view?reload=${reload}`)
              : (originalUrl(link.url) ?? '')
          }
          style={pageTheme(state)}
          referrerPolicy="no-referrer"
          onLoad={onLoad}
        />
      )}
      {timedOut && (preparing || framed) && <FrameLoadNotice href={link.url} />}
      {!preparing && !framed && (
        <div className="silo-original-card">
          <h2>{link.title || link.url}</h2>
          {link.description && <p>{link.description}</p>}
          <p>{fallbackReason(state.reason)}</p>
          <div className="silo-original-actions">
            <button type="button" className="silo-reader-btn" onClick={showReader}>
              Show Reader
            </button>
            <a
              className="silo-reader-btn"
              href={originalUrl(link.url)}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open in new tab
            </a>
          </div>
        </div>
      )}
      <div className="silo-frame-loading" data-loading={busy} aria-hidden={!busy}>
        <PageSkeleton url={link.url} label="Loading page..." />
      </div>
    </div>
  );
}

type OriginalProps = { link: LinkJson; state: OriginalState; showReader: () => void };

export function Original(props: OriginalProps) {
  const { link, state } = props;
  return (
    <div className="silo-original" data-mode={state.mode}>
      {state.embed ? (
        <div className="silo-original-player">
          <ReaderPlayer key={state.reload} embed={state.embed} url={link.url} fill />
        </div>
      ) : (
        <PageSurface {...props} />
      )}
    </div>
  );
}
