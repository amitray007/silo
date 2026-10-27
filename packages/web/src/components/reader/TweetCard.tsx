import { apiUrl } from '../../api/client';
import type { LinkJson } from '../../api/types';
import { formatPostCount } from '../../lib/formatCount';
import { formatTweetDate, parseTweetDate } from '../../lib/tweetDate';
import { PostText } from './PostText';
import { ReaderIcon } from './ReaderIcon';
import { TweetMedia } from './TweetMedia';

export type TweetSource = Extract<LinkJson['sourceData'], { kind: 'twitter' }>;

type Counts = { replies?: number; reposts?: number; likes?: number; bookmarks?: number };

/** One post of the card: the saved post or a post of the author's thread. */
type Row = {
  counts: Counts;
  key: string;
  text: string;
  postedAt: string | undefined;
  mediaUrls: readonly string[] | undefined;
  hasPoster: boolean;
  /** How the media proxy names this post: `after-2`; the saved post needs none. */
  scope: string | undefined;
  saved: boolean;
};

function savedRow(source: TweetSource): Row {
  return {
    key: 'saved',
    counts: source,
    text: source.text,
    postedAt: source.postedAt,
    mediaUrls: source.mediaUrls,
    hasPoster: Boolean(source.thumbnailUrl),
    scope: undefined,
    saved: true,
  };
}

function threadRows(source: TweetSource): Row[] {
  const thread = (side: 'before' | 'after', posts: TweetSource['threadBefore']): Row[] =>
    (posts ?? []).map((post, index) => ({
      key: post.id,
      counts: {
        ...(post.replies !== undefined && { replies: post.replies }),
        ...(post.reposts !== undefined && { reposts: post.reposts }),
        ...(post.likes !== undefined && { likes: post.likes }),
      },
      text: post.text,
      postedAt: post.postedAt,
      mediaUrls: post.mediaUrls,
      hasPoster: Boolean(post.thumbnailUrl),
      scope: `${side}-${index}`,
      saved: false,
    }));
  return [
    ...thread('before', source.threadBefore),
    savedRow(source),
    ...thread('after', source.threadAfter),
  ];
}

function Avatar({ linkId }: { linkId: string }) {
  return (
    // silo's own proxy serves the stored picture, so the browser never calls X.
    <img
      key={linkId}
      className="silo-reader-avatar"
      src={apiUrl(`/api/links/${encodeURIComponent(linkId)}/source-media/avatar`)}
      alt=""
      width={36}
      height={36}
      onError={(event) => {
        event.currentTarget.hidden = true;
      }}
    />
  );
}

function PostedTime({ raw }: { raw: string | undefined }) {
  const posted = parseTweetDate(raw);
  if (!posted) return null;
  return (
    <time
      className="silo-reader-posted"
      dateTime={posted.toISOString()}
      title={posted.toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' })}
    >
      {formatTweetDate(posted)}
    </time>
  );
}

const ACTIONS = [
  { key: 'replies', icon: 'reply', one: 'reply', many: 'replies' },
  { key: 'reposts', icon: 'repost', one: 'repost', many: 'reposts' },
  { key: 'likes', icon: 'heart', one: 'like', many: 'likes' },
  { key: 'bookmarks', icon: 'bookmark', one: 'bookmark', many: 'bookmarks' },
] as const;

/** X's action bar, read-only: icon and short count, the exact count on hover and for screen readers. */
function Stats({ counts, compact = false }: { counts: Counts; compact?: boolean }) {
  const shown = ACTIONS.filter((action) => counts[action.key] !== undefined);
  if (shown.length === 0) return null;
  return (
    <ul className="silo-reader-stats" data-compact={compact || undefined}>
      {shown.map(({ key, icon, one, many }) => {
        const count = counts[key] ?? 0;
        const label = `${count.toLocaleString()} ${count === 1 ? one : many}`;
        return (
          <li key={key} className="silo-post-stat" title={label}>
            <ReaderIcon name={icon} size={compact ? 16 : 18} />
            {/* X leaves a zero count blank. */}
            <span aria-hidden="true">{count > 0 ? formatPostCount(count) : ''}</span>
            <span className="silo-sr-only">{label}</span>
          </li>
        );
      })}
    </ul>
  );
}

function Media({ linkId, row }: { linkId: string; row: Row }) {
  if (!row.mediaUrls) return null;
  return (
    <TweetMedia
      key={linkId}
      linkId={linkId}
      mediaUrls={row.mediaUrls}
      hasPoster={row.hasPoster}
      {...(row.scope ? { scope: row.scope } : {})}
    />
  );
}

function Who({ source }: { source: TweetSource }) {
  return (
    <>
      <strong>{source.authorName}</strong> <span>@{source.authorHandle}</span>
    </>
  );
}

function ThreadRow({
  linkId,
  source,
  row,
  first,
  last,
  marked,
}: {
  linkId: string;
  source: TweetSource;
  row: Row;
  first: boolean;
  last: boolean;
  marked: boolean;
}) {
  return (
    <li
      className="silo-thread-post"
      data-saved={row.saved || undefined}
      // With a saved post mid-thread, the other posts read a little quieter.
      data-dim={(marked && !row.saved) || undefined}
    >
      <div className="silo-thread-rail">
        {source.authorAvatarUrl ? (
          <Avatar linkId={linkId} />
        ) : (
          <span className="silo-reader-avatar" aria-hidden="true" />
        )}
        {!last && <span className="silo-thread-line" aria-hidden="true" />}
      </div>
      <div className="silo-thread-body">
        {first && (
          <div className="silo-reader-who">
            <Who source={source} />
          </div>
        )}
        {row.saved && marked && <span className="silo-thread-saved">Saved post</span>}
        {row.text && (
          <p>
            <PostText text={row.text} />
          </p>
        )}
        <Media linkId={linkId} row={row} />
        <PostedTime raw={row.postedAt} />
        <Stats counts={row.counts} compact={!row.saved} />
      </div>
    </li>
  );
}

/** The saved post followed or preceded by the rest of the author's thread, like X's thread view. */
function ThreadCard({ linkId, source }: { linkId: string; source: TweetSource }) {
  const rows = threadRows(source);
  const marked = (source.threadBefore?.length ?? 0) > 0;
  return (
    <>
      <div className="silo-reader-thread-label" id={`thread-${linkId}`}>
        Thread · {rows.length} posts
      </div>
      <ol className="silo-reader-tweet silo-reader-thread" aria-labelledby={`thread-${linkId}`}>
        {rows.map((row, index) => (
          <ThreadRow
            key={`${linkId}:${row.key}`}
            linkId={linkId}
            source={source}
            row={row}
            first={index === 0}
            last={index === rows.length - 1}
            marked={marked}
          />
        ))}
      </ol>
    </>
  );
}

function SingleCard({ linkId, source }: { linkId: string; source: TweetSource }) {
  return (
    <div className="silo-reader-tweet">
      <div className="silo-reader-who">
        {source.authorAvatarUrl && <Avatar linkId={linkId} />}
        <Who source={source} />
      </div>
      <p>
        <PostText text={source.text} />
      </p>
      <Media linkId={linkId} row={savedRow(source)} />
      <PostedTime raw={source.postedAt} />
      <Stats counts={source} />
    </div>
  );
}

/** An X post in the Reader: one card, or a thread when the author's other posts were captured. */
export function TweetCard({ linkId, source }: { linkId: string; source: TweetSource }) {
  const hasThread = Boolean(source.threadBefore?.length || source.threadAfter?.length);
  return hasThread ? (
    <ThreadCard linkId={linkId} source={source} />
  ) : (
    <SingleCard linkId={linkId} source={source} />
  );
}
