import { useId, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import type { ApiError } from '../api/client';
import { useFeed } from '../api/hooks';
import { FeedMenu } from '../components/FeedMenu';
import { ReaderLayout } from '../components/reader/ReaderLayout';
import { SegmentTabs } from '../components/reader/ReaderSegment';
import { ListBody } from './shared/ListBodies';
import { ContentFrame } from './shared/ListHeader';
import { EmptyState, ErrorState } from './shared/ListStates';
import { useListView } from './shared/useListView';

function FeedHeading({ title }: { title: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <span className="silo-feed-heading">
      <Link to="/feeds" className="silo-feed-breadcrumb">
        Feeds /
      </Link>
      <button
        type="button"
        className="silo-feed-title"
        title={title}
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
      >
        <span data-expanded={expanded}>{title}</span>
      </button>
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
        count={
          tab === 'inbox'
            ? feed.data?.feed.inboxCount
            : feed.data
              ? feed.data.feed.postCount - feed.data.feed.inboxCount
              : undefined
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
