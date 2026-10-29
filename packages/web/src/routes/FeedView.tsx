import { useId } from 'react';
import { useParams, useSearchParams } from 'react-router';
import type { ApiError } from '../api/client';
import { useFeed } from '../api/hooks';
import { ReaderLayout } from '../components/reader/ReaderLayout';
import { SegmentTabs } from '../components/reader/ReaderSegment';
import { ListBody } from './shared/ListBodies';
import { ContentFrame } from './shared/ListHeader';
import { EmptyState, ErrorState } from './shared/ListStates';
import { useListView } from './shared/useListView';

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
        headerSlot={null}
        title={title}
        count={
          tab === 'inbox'
            ? feed.data?.feed.inboxCount
            : feed.data
              ? feed.data.feed.postCount - feed.data.feed.inboxCount
              : undefined
        }
        fadeKey={id}
      >
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
