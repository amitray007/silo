import type { CSSProperties } from 'react';
import { apiUrl } from '../../api/client';
import type { LinkJson } from '../../api/types';
import { formatSnapshotDate } from '../../lib/snapshotDate';
import { ReaderIcon } from './ReaderIcon';
import { FrameLoadNotice, PageSkeleton, useFrameLoading } from './ReaderLoading';
import { ReaderPlayer } from './ReaderPlayer';
import type { OriginalState } from './useOriginal';
import { originalUrl } from './useReaderActions';

const LOAD_ERRORS = [
  'fetch-error',
  'dns-error',
  'timeout',
  'http-error',
  'not-found',
  'too-many-redirects',
  'body-too-large',
];

function fallbackCopy(reason: string | undefined): { title: string; body: string } {
  if (reason === 'blocked')
    return {
      title: 'This site blocks Silo',
      body: 'Silo cannot show it here. The Reader may still have the text, or you can open the site in your browser.',
    };
  if (reason === 'needs-script')
    return {
      title: 'This page needs its own scripts',
      body: 'Silo cannot show it here. Open the site in your browser, or check the Reader for saved text.',
    };
  if (LOAD_ERRORS.includes(reason ?? ''))
    return {
      title: 'Silo could not load this page',
      body: "Silo's request for the page failed. Open it in your browser, or check the Reader for saved text.",
    };
  return {
    title: 'This page cannot be shown here',
    body: 'Open the site in your browser, or check the Reader for saved text.',
  };
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function pageTheme(state: OriginalState): CSSProperties {
  if (state.theme !== 'dark') return {};
  if (!state.darkPage) return { colorScheme: 'light' };
  if (state.mode !== 'direct' || state.darkTheme !== false) return {};
  return { filter: 'invert(0.9) hue-rotate(180deg)', backgroundColor: 'white' };
}

function frameSandbox(mode: OriginalState['mode']): string {
  if (mode === 'archive')
    return 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox';
  if (mode === 'view') return 'allow-scripts allow-popups allow-popups-to-escape-sandbox';
  return 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-presentation';
}

function frameUrl(link: LinkJson, state: OriginalState): string {
  if (state.mode === 'archive') return state.archiveUrl ?? '';
  if (state.mode === 'view')
    return apiUrl(`/api/links/${encodeURIComponent(link.id)}/view?reload=${state.reload}`);
  return originalUrl(link.url) ?? '';
}

function FallbackCard({
  link,
  reason,
  showReader,
}: {
  link: LinkJson;
  reason: string | undefined;
  showReader: () => void;
}) {
  const { title, body } = fallbackCopy(reason);
  const id = `silo-original-card-${link.id}`;
  return (
    <section className="silo-original-card silo-reader-empty" aria-labelledby={id}>
      <span className="silo-reader-empty-icon">
        <ReaderIcon name="page" />
      </span>
      <h3 id={id}>{title}</h3>
      <p>{body}</p>
      <div className="silo-reader-empty-actions">
        <button type="button" className="silo-reader-btn" onClick={showReader}>
          Show Reader
        </button>
        <a
          className="silo-reader-btn"
          href={originalUrl(link.url)}
          target="_blank"
          rel="noopener noreferrer"
        >
          <ReaderIcon name="arrowUpRight" size={16} />
          Open site
        </a>
      </div>
      <p className="silo-original-meta">{link.title?.trim() || hostOf(link.url)}</p>
    </section>
  );
}

function ArchiveBar({ link, snapshotAt }: { link: LinkJson; snapshotAt: string | undefined }) {
  const date = formatSnapshotDate(snapshotAt);
  return (
    <div className="silo-original-bar">
      <span>Internet Archive copy{date ? ` from ${date}` : ''}. This site blocks Silo.</span>
      <a href={originalUrl(link.url)} target="_blank" rel="noopener noreferrer">
        Open live site
      </a>
    </div>
  );
}

function PageSurface({ link, state, showReader }: OriginalProps) {
  const { mode, preparing, reload } = state;
  const { loading, timedOut, onLoad } = useFrameLoading(`${link.id}-${link.url}-${reload}`, 0);
  const framed = mode === 'direct' || mode === 'view' || mode === 'archive';
  const busy = loading && (preparing || framed);
  return (
    <div className="silo-original-surface" data-mode={mode} aria-busy={busy}>
      {mode === 'archive' && <ArchiveBar link={link} snapshotAt={state.snapshotAt} />}
      {framed && (
        <iframe
          key={`${mode}-${reload}`}
          title={mode === 'view' ? 'Silo view' : 'Live page'}
          sandbox={frameSandbox(mode)}
          className="silo-original-frame"
          src={frameUrl(link, state)}
          style={pageTheme(state)}
          referrerPolicy="no-referrer"
          onLoad={onLoad}
        />
      )}
      {timedOut && (preparing || framed) && <FrameLoadNotice href={link.url} />}
      {!preparing && !framed && (
        <FallbackCard link={link} reason={state.reason} showReader={showReader} />
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
