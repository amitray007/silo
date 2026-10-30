import { useState } from 'react';
import { Link, useMatch, useNavigate } from 'react-router';
import { useFeeds } from '../api/hooks';
import type { FeedJson } from '../api/types';
import { formatCount } from '../lib/formatCount';
import { deriveDomain } from '../lib/url';
import { useSidebarPagination } from '../lib/useSidebarPagination';
import { AddFeedDialog } from './AddFeedDialog';
import { Chip } from './Chip';
import { FeedMenu } from './FeedMenu';
import { NavItem } from './NavItem';
import { ReaderIcon } from './reader/ReaderIcon';

function FeedLink({ feed, onNavigate }: { feed: FeedJson; onNavigate: () => void }) {
  const to = `/feeds/${feed.id}`;
  const active = Boolean(useMatch(to));
  const navigate = useNavigate();
  return (
    <FeedMenu feed={feed}>
      <NavItem
        href={to}
        title={feed.title}
        label={feed.title}
        variant="tag"
        active={active}
        icon={<Chip domain={deriveDomain(feed.siteUrl ?? feed.feedUrl)} size={16} />}
        meta={
          <>
            <span role="img" aria-label={`${feed.inboxCount} in Inbox`}>
              {formatCount(feed.inboxCount)}
            </span>
            {feed.status !== 'active' && (
              <span
                className="silo-feed-warning"
                role="img"
                aria-label={feed.lastError ?? 'Feed unavailable'}
                title={feed.lastError ?? 'Feed unavailable'}
              >
                <ReaderIcon name="warning" size={14} />
              </span>
            )}
          </>
        }
        onClick={(event) => {
          if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
            return;
          event.preventDefault();
          navigate(to);
          onNavigate();
        }}
      />
    </FeedMenu>
  );
}

export function SidebarFeeds({ onNavigate }: { onNavigate: () => void }) {
  const [expanded, setExpanded] = useState(true);
  const [adding, setAdding] = useState(false);
  const feeds = useFeeds();
  const rows = feeds.data?.feeds ?? [];
  const activeId = useMatch('/feeds/:id')?.params.id;
  const page = useSidebarPagination(
    rows.length,
    rows.findIndex((feed) => feed.id === activeId),
    expanded,
  );
  return (
    <div className="silo-tags" data-expanded={expanded}>
      <div className="silo-tags-header">
        <div className="silo-tags-title silo-feeds-section-title">
          <Link to="/feeds" className="silo-tags-label" onClick={onNavigate}>
            Feeds
          </Link>
          <button
            type="button"
            className="silo-tags-toggle"
            aria-label="Toggle feeds"
            aria-expanded={expanded}
            aria-controls="silo-feed-list"
            onClick={() => setExpanded(!expanded)}
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 10 10"
              className="silo-section-caret"
              data-expanded={expanded}
              aria-hidden="true"
            >
              <path d="M1.5 3h7L5 7.5z" />
            </svg>
          </button>
        </div>
      </div>
      {expanded && (
        <div id="silo-feed-list" className="silo-tags-body">
          {feeds.isLoading && (
            <span className="silo-feed-description" role="status">
              Loading feeds…
            </span>
          )}
          {feeds.isError && (
            <p className="silo-feed-error" role="alert">
              Couldn't load feeds.
            </p>
          )}
          <section ref={page.scrollRef} className="silo-tag-scroll" aria-label="Feed subscriptions">
            {rows.slice(0, page.visibleCount).map((feed) => (
              <FeedLink key={feed.id} feed={feed} onNavigate={onNavigate} />
            ))}
            {page.hasMore && (
              <div ref={page.sentinelRef} className="silo-sidebar-sentinel" aria-hidden="true" />
            )}
          </section>
          <NavItem
            title="Add feed"
            variant="tag"
            label="Add feed"
            icon={<ReaderIcon name="plus" />}
            onClick={() => {
              setAdding(true);
              onNavigate();
            }}
          />
        </div>
      )}
      {adding && <AddFeedDialog onClose={() => setAdding(false)} onSubscribed={onNavigate} />}
    </div>
  );
}
