import { Component, type ReactNode } from 'react';

type Props = { children: ReactNode; kind: 'reader' | 'settings' | 'feed' };

/** Keep a failed optional chunk inside the surface that requested it. */
export class ChunkErrorBoundary extends Component<Props, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    if (this.props.kind === 'reader') return null;
    return (
      <div role="alert">
        <p>{this.props.kind === 'settings' ? 'Could not load this tab' : 'Could not load feeds'}</p>
        <button type="button" className="silo-reader-btn" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    );
  }
}
