import { useRetryCapture } from '../../api/hooks';
import type { LinkJson } from '../../api/types';
import { previewImageUrl } from '../../lib/previewImage';

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

function NoCapturedText({ link }: { link: LinkJson }) {
  return (
    <div className="silo-reader-retry">
      <p>No text was captured for this page.</p>
      <a className="silo-reader-btn" href={link.url} target="_blank" rel="noopener noreferrer">
        Open original
      </a>
      {(link.captureStatus === 'partial' || link.captureStatus === 'bare') && (
        <RetryCapture id={link.id} />
      )}
    </div>
  );
}

export function ReaderContent({ link }: { link: LinkJson }) {
  if (link.captureStatus === 'enriching')
    return (
      <div role="status" aria-label="Capturing page">
        {[92, 84, 88, 60].map((width) => (
          <div key={width} className="silo-reader-skeleton" style={{ width: `${width}%` }} />
        ))}
        <p className="silo-reader-hint">
          ◌ Fetching the page text and metadata. This view fills in when capture finishes.
        </p>
      </div>
    );

  const source = link.sourceData;
  if (source.kind === 'twitter')
    return (
      <div className="silo-reader-tweet">
        <div className="silo-reader-who">
          <strong>{source.authorName}</strong> <span>@{source.authorHandle}</span>
        </div>
        <p>{source.text}</p>
        <div className="silo-reader-stats">
          <span>{source.likes} likes</span>
          <span>{source.reposts} reposts</span>
          <span>{source.replies} replies</span>
        </div>
      </div>
    );

  return (
    <>
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
          <img
            src={previewImageUrl(link.id)}
            alt="Video thumbnail"
            loading="lazy"
            onError={(event) => {
              event.currentTarget.hidden = true;
            }}
          />
          <figcaption>{source.channel}</figcaption>
        </figure>
      )}
      <Paragraphs link={link} />
      {!link.extractedText?.trim() && !link.description?.trim() && <NoCapturedText link={link} />}
    </>
  );
}
