import { Component, type ReactNode } from 'react';

type Props = { children: ReactNode; kind: 'reader' | 'settings' | 'feed' | 'librarian' };

// Browser wording for a dynamic import or CSS preload that could not load.
const CHUNK_ERROR =
  /dynamically imported module|importing a module script failed|unable to preload css/i;

function isChunkLoadError(error: unknown): boolean {
  return (
    error instanceof Error && (error.name === 'ChunkLoadError' || CHUNK_ERROR.test(error.message))
  );
}

const CHUNK_WORDS = {
  reader: '',
  settings: 'Could not load this tab',
  feed: 'Could not load feeds',
  librarian: 'Could not load the Librarian',
} as const;

/**
 * Keep a failed optional chunk inside the surface that requested it. Any other
 * error is rethrown so it reaches the app's root boundary as before.
 */
export class ChunkErrorBoundary extends Component<Props, { error: unknown }> {
  override state: { error: unknown } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  override render() {
    const { error } = this.state;
    if (error === null) return this.props.children;
    if (!isChunkLoadError(error)) throw error;
    if (this.props.kind === 'reader') return null;
    return (
      <div role="alert">
        <p>{CHUNK_WORDS[this.props.kind]}</p>
        <button type="button" className="silo-reader-btn" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    );
  }
}
