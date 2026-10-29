import { useState } from 'react';
import { useMatch, useNavigate } from 'react-router';
import { useFeeds } from '../api/hooks';
import type { FeedJson } from '../api/types';
import { formatCount } from '../lib/formatCount';
import { deriveDomain } from '../lib/url';
import { AddFeedDialog } from './AddFeedDialog';
import { Chip } from './Chip';
import { NavItem } from './NavItem';
import { ReaderIcon } from './reader/ReaderIcon';

function FeedLink({ feed, onNavigate }: { feed: FeedJson; onNavigate: () => void }) {
  const to = `/feeds/${feed.id}`;
  const active = Boolean(useMatch(to));
  const navigate = useNavigate();
  return (
    <NavItem
      href={to}
      title={feed.title}
      label={feed.title}
      variant="tag"
      active={active}
      icon={<Chip domain={deriveDomain(feed.siteUrl ?? feed.feedUrl)} size={16} />}
      meta={formatCount(feed.postCount)}
      onClick={(event) => {
        if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
          return;
        event.preventDefault();
        navigate(to);
        onNavigate();
      }}
    />
  );
}

export function SidebarFeeds({ onNavigate }: { onNavigate: () => void }) {
  const [expanded, setExpanded] = useState(true);
  const [adding, setAdding] = useState(false);
  const feeds = useFeeds();
  return (
    <div className="silo-tags">
      <div className="silo-tags-header">
        <div className="silo-tags-title">
          <button
            type="button"
            className="silo-tags-toggle"
            aria-expanded={expanded}
            aria-controls="silo-feed-list"
            onClick={() => setExpanded(!expanded)}
          >
            <span className="silo-tags-label">Feeds</span>
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
        <div id="silo-feed-list">
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
          <div className="silo-tag-scroll">
            {feeds.data?.feeds?.map((feed) => (
              <FeedLink key={feed.id} feed={feed} onNavigate={onNavigate} />
            ))}
          </div>
          <NavItem
            title="Add feed"
            variant="tag"
            label="Add feed"
            icon={<ReaderIcon name="plus" />}
            onClick={() => setAdding(true)}
          />
        </div>
      )}
      {adding && <AddFeedDialog onClose={() => setAdding(false)} onSubscribed={onNavigate} />}
    </div>
  );
}
