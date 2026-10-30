import { useId } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import type { ApiError } from '../api/client';
import { useFeed } from '../api/feedHooks';

import type { FeedJson } from '../api/types';
import { FeedMenu } from '../components/FeedMenu';
import { ReaderLayout } from '../components/reader/ReaderLayout';
import { SegmentTabs } from '../components/reader/ReaderSegment';
import { ListBody } from './shared/ListBodies';
import { ContentFrame } from './shared/ListHeader';
import { EmptyState, ErrorState } from './shared/ListStates';
import { useListView } from './shared/useListView';

function FeedHeading({ title }: { title: string }) {
  return (
    <span className="silo-feed-heading">
      <Link to="/feeds" className="silo-feed-breadcrumb">
        Feeds /
      </Link>
      <span className="silo-feed-title" title={title}>
        {title}
      </span>
    </span>
  );
}

function FeedCount({ feed, tab }: { feed: FeedJson; tab: 'inbox' | 'archive' }) {
  const count = tab === 'inbox' ? feed.inboxCount : feed.postCount - feed.inboxCount;
  return (
    <span role="img" aria-label={`${count} in ${tab === 'inbox' ? 'Inbox' : 'Archive'}`}>
      {count}
    </span>
  );
}

export function FeedView() {
  const { id = '' } = useParams<{ id: string }>();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'archive' ? 'archive' : 'inbox';
  const tabsId = useId();
  const feed = useFeed(id);
  const view = useListView(undefined, id, tab);
  const title = `Feeds / ${feed.data?.feed.title ?? 'Feed'}`;
  return (
    <ReaderLayout
      key={id}
      links={view.links}
      loading={view.isLoading}
      title={title}
      hasNextPage={Boolean(view.hasNextPage)}
      fetchNextPage={view.fetchNextPage}
    >
      <ContentFrame
        headerSlot={feed.data ? <FeedMenu key={id} feed={feed.data.feed} /> : null}
        title={<FeedHeading key={id} title={feed.data?.feed.title ?? 'Feed'} />}
        count={feed.data ? <FeedCount feed={feed.data.feed} tab={tab} /> : undefined}
        headerBelow={
          <div className="silo-feed-tabs">
            <SegmentTabs
              id={tabsId}
              tab={tab}
              disabled={false}
              label="Feed posts"
              tabs={[
                { value: 'inbox', label: 'Inbox' },
                { value: 'archive', label: 'Archive' },
              ]}
              setTab={(next) => {
                setParams((current) => {
                  const params = new URLSearchParams(current);
                  params.set('tab', next);
                  params.delete('link');
                  return params;
                });
              }}
            />
          </div>
        }
        fadeKey={id}
      >
        {feed.data && feed.data.feed.status !== 'active' && (
          <p role="status" className="silo-feed-notice">
            {feed.data.feed.status === 'gone'
              ? 'This feed has stopped updating.'
              : "Couldn't update this feed."}
            {feed.data.feed.lastError && <> {feed.data.feed.lastError}</>}
          </p>
        )}
        <div role="tabpanel" id={`${tabsId}-panel`} aria-labelledby={`${tabsId}-${tab}`}>
          {feed.isError ? (
            <ErrorState error={feed.error as ApiError} />
          ) : (
            ListBody(
              view,
              <EmptyState
                title={tab === 'archive' ? 'No archived posts' : 'No posts yet'}
                body={
                  tab === 'archive'
                    ? 'Posts you archive will appear here.'
                    : 'New posts will appear here when this feed updates.'
                }
              />,
              true,
            )
          )}
        </div>
      </ContentFrame>
    </ReaderLayout>
  );
}
