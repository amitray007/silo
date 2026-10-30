import { useRef, useState } from 'react';
import { Link, useMatch, useNavigate } from 'react-router';
import { useFeeds } from '../api/feedHooks';
import type { FeedJson } from '../api/types';
import { formatCount } from '../lib/formatCount';
import { deriveDomain } from '../lib/url';
import { useSidebarPagination } from '../lib/useSidebarPagination';
import { AddFeedDialog } from './AddFeedDialog';
import { Chip } from './Chip';
import { FeedMenu } from './FeedMenu';
import { NavItem } from './NavItem';
import { ReaderIcon } from './reader/ReaderIcon';
import { SectionCaret } from './SectionCaret';
import { SidebarFindButton, SidebarFindEmpty, SidebarFindInput } from './SidebarFind';
import { SidebarRowSkeletonList } from './SidebarRowSkeleton';

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
  const [findOpen, setFindOpen] = useState(false);
  const [autoFocusOnOpen, setAutoFocusOnOpen] = useState(false);
  const [query, setQuery] = useState('');
  const findButtonRef = useRef<HTMLButtonElement>(null);
  const feeds = useFeeds();
  const trimmedQuery = query.trim().toLowerCase();
  const rows = (feeds.data?.feeds ?? []).filter((feed) =>
    feed.title.toLowerCase().includes(trimmedQuery),
  );
  const activeId = useMatch('/feeds/:id')?.params.id;
  const page = useSidebarPagination(
    rows.length,
    rows.findIndex((feed) => feed.id === activeId),
    expanded,
    trimmedQuery,
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
            onClick={() => {
              setAutoFocusOnOpen(false);
              setExpanded(!expanded);
            }}
          >
            <SectionCaret expanded={expanded} />
          </button>
        </div>
        <span style={{ flex: 1 }} />
        <SidebarFindButton
          ref={findButtonRef}
          label="Find a feed"
          open={findOpen}
          onClick={() => {
            setAutoFocusOnOpen(!findOpen && expanded);
            setFindOpen(!findOpen);
            if (findOpen) setQuery('');
          }}
        />
      </div>
      {expanded && (
        <div id="silo-feed-list" className="silo-tags-body">
          {findOpen && (
            <SidebarFindInput
              value={query}
              onChange={setQuery}
              placeholder="Find feed"
              autoFocusOnOpen={autoFocusOnOpen}
              onClose={() => {
                setFindOpen(false);
                findButtonRef.current?.focus();
              }}
            />
          )}
          {feeds.isLoading && (
            <span className="silo-sr-only" role="status">
              Loading feeds
            </span>
          )}
          {feeds.isError && (
            <p className="silo-feed-error" role="alert">
              Couldn't load feeds.
            </p>
          )}
          <section
            ref={page.scrollRef}
            className="silo-tag-scroll"
            aria-label="Feed subscriptions"
            aria-busy={feeds.isLoading}
          >
            {feeds.isLoading && <SidebarRowSkeletonList kind="feeds" />}
            {feeds.isSuccess && trimmedQuery && rows.length === 0 && (
              <SidebarFindEmpty kind="feeds" query={query} />
            )}
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
