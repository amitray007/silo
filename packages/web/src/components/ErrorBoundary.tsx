import { Component, type ReactNode } from 'react';
import { CenteredPanel } from './CenteredPanel';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

/**
 * Catches render errors anywhere in the wrapped tree and shows a calm Oat
 * fallback instead of a white-screened `#root`. Matches ComingSoon's
 * centered, chrome-free feel (see docs/design/tokens.md).
 *
 * Placement (main.tsx): ThemeProvider > ErrorBoundary > QueryClientProvider >
 * BrowserRouter > App. ThemeProvider stays outermost so `data-theme` is
 * already applied and this fallback renders themed; ErrorBoundary sits just
 * inside it so a render error anywhere in query/router/App is caught.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  override componentDidCatch(error: Error, info: { componentStack: string }) {
    // Real error, kept for debugging — this is the only place it's surfaced
    // once the fallback replaces the crashed tree.
    console.error('ErrorBoundary caught an error:', error, info.componentStack);
  }

  override render() {
    if (this.state.hasError) {
      return (
        <CenteredPanel>
          <p
            style={{ margin: 0, fontSize: 'var(--text-md)', fontWeight: 500, color: 'var(--ink)' }}
          >
            Something went wrong
          </p>
          <p
            style={{
              margin: '6px 0 20px',
              fontSize: 'var(--text-base)',
              color: 'var(--mut)',
              maxWidth: '24rem',
            }}
          >
            Try reloading the page. If it keeps happening, the console has the details.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              border: '1px solid var(--line)',
              background: 'var(--bg2)',
              color: 'var(--ink)',
              borderRadius: '6px',
              padding: '6px 14px',
              fontSize: 'var(--text-base)',
              fontFamily: 'inherit',
              cursor: 'pointer',
            }}
          >
            Reload
          </button>
        </CenteredPanel>
      );
    }

    return this.props.children;
  }
}
