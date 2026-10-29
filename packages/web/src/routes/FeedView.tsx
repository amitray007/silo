import { useParams } from 'react-router';
import type { ApiError } from '../api/client';
import { useFeed } from '../api/hooks';
import { ReaderLayout } from '../components/reader/ReaderLayout';
import { ListBody } from './shared/ListBodies';
import { ContentFrame } from './shared/ListHeader';
import { EmptyState, ErrorState } from './shared/ListStates';
import { useListView } from './shared/useListView';

export function FeedView() {
  const { id = '' } = useParams<{ id: string }>();
  const feed = useFeed(id);
  const view = useListView(undefined, id);
  const title = `Feeds / ${feed.data?.feed.title ?? 'Feed'}`;
  return (
    <ReaderLayout
      links={view.links}
      loading={view.isLoading}
      title={title}
      hasNextPage={Boolean(view.hasNextPage)}
      fetchNextPage={view.fetchNextPage}
    >
      <ContentFrame headerSlot={null} title={title} count={feed.data?.feed.postCount} fadeKey={id}>
        {feed.isError ? (
          <ErrorState error={feed.error as ApiError} />
        ) : (
          ListBody(
            view,
            <EmptyState
              title="No posts yet"
              body="New posts will appear here when this feed updates."
            />,
            true,
          )
        )}
      </ContentFrame>
    </ReaderLayout>
  );
}
