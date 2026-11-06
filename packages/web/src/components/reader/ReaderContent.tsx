import { useIsMutating } from '@tanstack/react-query';
import { lazy, Suspense, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { queryKeys, useLiveReader, useRetryCapture } from '../../api/hooks';
import type { LinkJson, LiveReaderJson } from '../../api/types';
import { previewImageUrl } from '../../lib/previewImage';
import { ChunkErrorBoundary } from '../ChunkErrorBoundary';
import { DockHostContext } from './dock/DockHostContext';
import { embedFor } from './embedFor';
import { ReaderIcon } from './ReaderIcon';
import { ReaderSkeleton } from './ReaderLoading';
import { ReaderProse } from './ReaderProse';
import { RelatedLinks } from './RelatedLinks';
import { TweetCard } from './TweetCard';

const loadReaderDock = () =>
  import('./dock/ReaderDock').then((module) => ({ default: module.ReaderDock }));
const ReaderDock = lazy(loadReaderDock);

function Paragraphs({ link }: { link: LinkJson }) {
  const text = link.extractedText?.trim() || link.description?.trim();
  if (!text) return null;
  return (
    <div className="silo-reader-body">
      {text.split(/\n\s*\n/).map((paragraph, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: immutable paragraphs from one captured text
        <p key={index}>{paragraph}</p>
      ))}
    </div>
  );
}

function RetryCapture({ id }: { id: string }) {
  const retry = useRetryCapture(id);
  return (
    <>
      <button
        type="button"
        className="silo-reader-btn"
        disabled={retry.isPending}
        onClick={() => retry.mutate()}
      >
        {retry.isPending ? 'Retrying…' : 'Retry capture'}
      </button>
      {retry.isError && <p role="alert">{retry.error.message}</p>}
    </>
  );
}

/** Capture skips non-HTML bodies, so a PDF link never has Reader text. */
function looksLikePdf(url: string): boolean {
  try {
    const { pathname } = new URL(url);
    return /\.pdf$/i.test(pathname) || /^\/pdf\//i.test(pathname);
  } catch {
    return false;
  }
}

const RESTRICTED_COPY = {
  paywalled: {
    title: 'Behind a paywall',
    reason: 'The site shows this article to subscribers only. Silo saved its details.',
  },
  blocked: {
    title: 'Blocked by the site',
    reason: 'This site stopped Silo with a bot check. Silo saved the link and its details.',
  },
} as const;

function emptyCopy(link: LinkJson): { title: string; reason: string } {
  if (link.readerAccess) return RESTRICTED_COPY[link.readerAccess];
  return {
    title: 'No text to read',
    reason: looksLikePdf(link.url)
      ? 'This link is a PDF. Silo saves its details but does not read PDF text yet.'
      : 'Silo saved this link but could not read text from the page.',
  };
}

function NoCapturedText({ link, showLive }: { link: LinkJson; showLive?: () => void }) {
  const retryable =
    Boolean(link.readerAccess) || link.captureStatus === 'partial' || link.captureStatus === 'bare';
  const { title, reason } = emptyCopy(link);
  return (
    <section className="silo-reader-empty" aria-labelledby={`silo-reader-empty-${link.id}`}>
      <span className="silo-reader-empty-icon">
        <ReaderIcon name="page" />
      </span>
      <h3 id={`silo-reader-empty-${link.id}`}>{title}</h3>
      <p>
        {reason}
        {link.readerAccess !== 'blocked' && showLive && ' Try the live page instead.'}
      </p>
      <div className="silo-reader-empty-actions">
        {link.readerAccess !== 'blocked' && showLive && (
          <button type="button" className="silo-reader-btn" onClick={showLive}>
            Show live page
          </button>
        )}
        {retryable && <RetryCapture id={link.id} />}
        <a className="silo-reader-btn" href={link.url} target="_blank" rel="noopener noreferrer">
          <ReaderIcon name="arrowUpRight" size={16} />
          Open original
        </a>
      </div>
    </section>
  );
}

/** Keep a failed refresh at the current position; a new capture starts at the top. */
function useReaderScrollReset(id: string, reader: LiveReaderJson | undefined, refreshing: boolean) {
  const capturedAt = reader?.capturedAt;
  const anchorRef = useRef<HTMLSpanElement>(null);
  const previous = useRef({ id, capturedAt });
  useEffect(() => {
    if (refreshing) return;
    if (previous.current.id === id && previous.current.capturedAt !== capturedAt) {
      const scroll = anchorRef.current?.closest<HTMLElement>('.silo-reader-scroll');
      if (scroll) scroll.scrollTop = 0;
    }
    previous.current = { id, capturedAt };
  }, [id, capturedAt, refreshing]);
  return anchorRef;
}

function readerLoadingLabel(refreshing: boolean, status: LinkJson['captureStatus']) {
  if (refreshing) return 'Refreshing reader';
  if (status === 'enriching') return 'Capturing page';
  return undefined;
}

function useProseReady(
  live: ReturnType<typeof useLiveReader>,
  loadingLabel: string | undefined,
  kind: LinkJson['sourceData']['kind'],
) {
  const ready = !loadingLabel && !live.isLoading && Boolean(live.data);
  const { report } = useContext(DockHostContext);
  useLayoutEffect(() => {
    report(ready && kind !== 'twitter');
    return () => report(false);
  }, [ready, kind, report]);
}

export function ReaderContent({
  link,
  trashed = false,
  showLive,
  topPlayerSrc,
}: {
  link: LinkJson;
  trashed?: boolean;
  showLive?: () => void;
  topPlayerSrc?: string | undefined;
}) {
  useEffect(() => {
    // Preload while the article loads; the local boundary handles a rejected import.
    void loadReaderDock().catch(() => {});
  }, []);
  const source = link.sourceData;
  // A trashed link has no live route, and an X post has no Reader. The stored text stands in
  // whenever the live Reader is absent or fails.
  const live = useLiveReader(
    link.id,
    !trashed && link.captureStatus !== 'enriching' && source.kind !== 'twitter',
  );
  const refreshing =
    useIsMutating({ mutationKey: queryKeys.refreshReader(link.id), exact: true }) > 0;
  const anchorRef = useReaderScrollReset(link.id, live.data, refreshing);
  const [proseElement, setProseElement] = useState<HTMLElement | null>(null);
  const loadingLabel = readerLoadingLabel(refreshing, link.captureStatus);
  useProseReady(live, loadingLabel, source.kind);
  if (loadingLabel) return <ReaderSkeleton label={loadingLabel} />;

  const embed = embedFor(link.url, source);
  const video = embed?.video;
  const prose = live.data;
  return (
    <>
      {source.kind === 'twitter' && <TweetCard linkId={link.id} source={source} />}

      {source.kind === 'hacker_news' && (
        <div className="silo-reader-card">
          <div>
            <b>{source.points}</b>points
          </div>
          <div>
            <b>{source.comments}</b>comments
          </div>
          <div>
            <b>{source.author}</b>author
          </div>
        </div>
      )}
      {source.kind === 'github' && (
        <div className="silo-reader-card">
          <div>
            <b>{source.stars}</b>stars
          </div>
          <div>
            <b>{source.forks}</b>forks
          </div>
          <div>
            <b>{source.issues}</b>issues
          </div>
          {source.language && (
            <div>
              <b>{source.language}</b>language
            </div>
          )}
        </div>
      )}
      {source.kind === 'youtube' && (
        <figure className="silo-reader-video">
          {!video && (
            <img
              src={previewImageUrl(link.id)}
              alt="Video thumbnail"
              loading="lazy"
              onError={(event) => {
                event.currentTarget.hidden = true;
              }}
            />
          )}
        </figure>
      )}
      <SourceNotice link={link} hasReader={Boolean(prose)} />
      <AccessNotice link={link} hasReader={Boolean(prose)} />
      {source.kind !== 'twitter' &&
        (live.isLoading ? (
          <ReaderSkeleton />
        ) : prose ? (
          <>
            {/* The positioned frame the pencil and the resume button draw in. */}
            <div className="silo-prose-frame">
              <ReaderProse
                key={prose.capturedAt}
                linkId={link.id}
                reader={prose}
                topPlayerSrc={topPlayerSrc}
                onRoot={setProseElement}
              />
            </div>
            {/* The dock and its layers are positioned overlays, so loading adds no flow height. */}
            <ChunkErrorBoundary kind="reader">
              <Suspense fallback={null}>
                <ReaderDock key={link.id} link={link} prose={proseElement} trashed={trashed} />
              </Suspense>
            </ChunkErrorBoundary>
          </>
        ) : (
          <Paragraphs link={link} />
        ))}
      {!prose && !live.isLoading && source.kind !== 'twitter' && hasNoText(link) && (
        <NoCapturedText link={link} {...(showLive && !trashed ? { showLive } : {})} />
      )}
      {/* Finds the Reader's scroll area for the refresh scroll reset; renders nothing. */}
      <span ref={anchorRef} hidden />
      <RelatedLinks link={link} html={prose?.contentHtml} trashed={trashed} />
    </>
  );
}

function hasNoText(link: LinkJson): boolean {
  return !link.extractedText?.trim() && Boolean(link.readerAccess || !link.description?.trim());
}
function AccessNotice({ link, hasReader }: { link: LinkJson; hasReader: boolean }) {
  if (link.readerAccess !== 'paywalled' || !(hasReader || link.extractedText?.trim())) return null;
  // Text from the feed or the archive is not the page's free part.
  if (link.readerSource && link.readerSource !== 'page') return null;
  return (
    <p className="silo-reader-access-notice">
      Subscriber article. Silo saved the part the site shows to everyone.{' '}
      <a href={link.url} target="_blank" rel="noopener noreferrer">
        Open original
      </a>
    </p>
  );
}

function SourceNotice({ link, hasReader }: { link: LinkJson; hasReader: boolean }) {
  if (!(hasReader || link.extractedText)) return null;
  if (link.readerSource === 'feed')
    return <p className="silo-reader-access-notice">From the site's feed.</p>;
  if (link.readerSource !== 'archive' || !link.readerSourceAt) return null;
  const date = new Date(link.readerSourceAt);
  const stamp = date.toISOString().replace(/[-:T]/g, '').slice(0, 14);
  return (
    <p className="silo-reader-access-notice">
      <a
        href={`https://web.archive.org/web/${stamp}/${link.url}`}
        target="_blank"
        rel="noopener noreferrer"
      >
        From the Internet Archive, snapshot of{' '}
        {date.toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
          timeZone: 'UTC',
        })}
        .
      </a>
    </p>
  );
}
