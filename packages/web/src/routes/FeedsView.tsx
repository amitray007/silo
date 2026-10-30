import { useState } from 'react';
import { Link } from 'react-router';
import { useFeeds } from '../api/feedHooks';

import { AddFeedDialog } from '../components/AddFeedDialog';
import { Chip } from '../components/Chip';
import { ReaderIcon } from '../components/reader/ReaderIcon';
import { ReaderLayout } from '../components/reader/ReaderLayout';
import { formatCount } from '../lib/formatCount';
import { deriveDomain } from '../lib/url';
import { ContentFrame } from './shared/ListHeader';
import { EmptyState, LoadingState } from './shared/ListStates';

export function FeedsView() {
  const feeds = useFeeds();
  const [adding, setAdding] = useState(false);
  return (
    <ReaderLayout links={[]} title="Feeds" emptyMessage="Pick a feed to read its posts.">
      <ContentFrame
        title="Feeds"
        headerSlot={
          <button
            type="button"
            className="silo-reader-iconbtn"
            aria-label="Add feed"
            onClick={() => setAdding(true)}
          >
            <ReaderIcon name="plus" />
          </button>
        }
      >
        {feeds.isLoading && <LoadingState />}
        {feeds.isError && (
          <p role="alert" className="silo-feed-notice">
            Couldn't load feeds. {feeds.error.message}
          </p>
        )}
        {feeds.data?.feeds.length === 0 && (
          <EmptyState
            title="No feeds yet"
            body="Add a website or feed to see its latest posts here."
          />
        )}
        {feeds.data?.feeds.map((feed) => (
          <Link key={feed.id} to={`/feeds/${feed.id}`} className="silo-feeds-row">
            <Chip domain={deriveDomain(feed.siteUrl ?? feed.feedUrl)} size={20} />
            <span className="silo-feeds-row-title">{feed.title}</span>
            <span
              role="img"
              aria-label={`${feed.inboxCount} in Inbox`}
              className="silo-feeds-row-count"
            >
              {formatCount(feed.inboxCount)}
            </span>
            {feed.status !== 'active' && (
              <span
                role="img"
                aria-label={feed.lastError ?? 'Feed unavailable'}
                className="silo-feed-warning"
              >
                <ReaderIcon name="warning" size={16} />
              </span>
            )}
          </Link>
        ))}
      </ContentFrame>
      {adding && <AddFeedDialog onClose={() => setAdding(false)} onSubscribed={() => {}} />}
    </ReaderLayout>
  );
}
