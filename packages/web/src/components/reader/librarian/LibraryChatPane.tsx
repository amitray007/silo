import { lazy, Suspense } from 'react';
import { ChunkErrorBoundary } from '../../ChunkErrorBoundary';
import { Spinner } from '../../Spinner';

const ChatPane = lazy(() => import('./ChatPane').then((module) => ({ default: module.ChatPane })));

/** The Librarian's chat in the reader's place beside a list. Its code loads when a chat first shows. */
export function LibraryChatPane(props: {
  chatId: string | null;
  autoFocus: boolean;
  onBack: () => void;
  onCreated: (id: string) => void;
}) {
  return (
    <ChunkErrorBoundary kind="librarian">
      <Suspense
        fallback={
          <section className="silo-readerpane" aria-label="Librarian chat">
            <div className="silo-empty-reader">
              <Spinner label="Loading conversation" />
            </div>
          </section>
        }
      >
        <ChatPane {...props} backLabel="Back to list" />
      </Suspense>
    </ChunkErrorBoundary>
  );
}
