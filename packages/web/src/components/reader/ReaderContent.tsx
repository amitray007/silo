import { useIsMutating } from '@tanstack/react-query';
import { type RefObject, useEffect, useRef } from 'react';
import { queryKeys, useLiveReader, useRetryCapture } from '../../api/hooks';
import type { LinkJson, LiveReaderJson } from '../../api/types';
import { previewImageUrl } from '../../lib/previewImage';
import { relativeTimeFromNow } from '../../lib/relativeTime';
import { embedFor } from './embedFor';
import { ReaderIcon } from './ReaderIcon';
import { ReaderSkeleton } from './ReaderLoading';
import { ReaderProse } from './ReaderProse';
import { RelatedLinks } from './RelatedLinks';
import { TweetCard } from './TweetCard';

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

function NoCapturedText({ link, showLive }: { link: LinkJson; showLive?: () => void }) {
  const retryable = link.captureStatus === 'partial' || link.captureStatus === 'bare';
  const reason = looksLikePdf(link.url)
    ? 'This link is a PDF. Silo saves its details but does not read PDF text yet.'
    : 'Silo saved this link but could not read text from the page.';
  return (
    <section className="silo-reader-empty" aria-labelledby={`silo-reader-empty-${link.id}`}>
      <span className="silo-reader-empty-icon">
        <ReaderIcon name="page" />
      </span>
      <h3 id={`silo-reader-empty-${link.id}`}>No text to read</h3>
      <p>
        {reason}
        {showLive && ' Try the live page instead.'}
      </p>
      <div className="silo-reader-empty-actions">
        {showLive && (
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

function SavedReader({
  capturedAt,
  footerRef,
}: {
  capturedAt: string | null | undefined;
  footerRef: RefObject<HTMLElement | null>;
}) {
  if (!capturedAt) return null;
  return (
    <footer ref={footerRef} className="silo-reader-saved">
      <time dateTime={capturedAt}>Saved {relativeTimeFromNow(capturedAt)}</time>
    </footer>
  );
}

/** Keep a failed refresh at the current position; a new capture starts at the top. */
function useReaderScrollReset(id: string, reader: LiveReaderJson | undefined, refreshing: boolean) {
  const capturedAt = reader?.capturedAt;
  const footerRef = useRef<HTMLElement>(null);
  const previous = useRef({ id, capturedAt });
  useEffect(() => {
    if (refreshing) return;
    if (previous.current.id === id && previous.current.capturedAt !== capturedAt) {
      const scroll = footerRef.current?.closest<HTMLElement>('.silo-reader-scroll');
      if (scroll) scroll.scrollTop = 0;
    }
    previous.current = { id, capturedAt };
  }, [id, capturedAt, refreshing]);
  return footerRef;
}

function readerLoadingLabel(refreshing: boolean, status: LinkJson['captureStatus']) {
  if (refreshing) return 'Refreshing reader';
  if (status === 'enriching') return 'Capturing page';
  return undefined;
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
  const source = link.sourceData;
  // A trashed link has no live route, and an X post has no Reader. The stored text stands in
  // whenever the live Reader is absent or fails.
  const live = useLiveReader(
    link.id,
    !trashed && link.captureStatus !== 'enriching' && source.kind !== 'twitter',
  );
  const refreshing =
    useIsMutating({ mutationKey: queryKeys.refreshReader(link.id), exact: true }) > 0;
  const footerRef = useReaderScrollReset(link.id, live.data, refreshing);
  const loadingLabel = readerLoadingLabel(refreshing, link.captureStatus);
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
      {source.kind !== 'twitter' &&
        (live.isLoading ? (
          <ReaderSkeleton />
        ) : prose ? (
          <ReaderProse
            key={prose.capturedAt}
            linkId={link.id}
            reader={prose}
            topPlayerSrc={topPlayerSrc}
          />
        ) : (
          <Paragraphs link={link} />
        ))}
      {!prose &&
        !live.isLoading &&
        source.kind !== 'twitter' &&
        !link.extractedText?.trim() &&
        !link.description?.trim() && (
          <NoCapturedText link={link} {...(showLive && !trashed ? { showLive } : {})} />
        )}
      <SavedReader capturedAt={prose?.capturedAt} footerRef={footerRef} />
      <RelatedLinks link={link} html={prose?.contentHtml} trashed={trashed} />
    </>
  );
}
