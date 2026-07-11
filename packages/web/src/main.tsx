import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { DevTools } from './dev/DevTools';
import './styles/base.css';
import { ThemeProvider } from './theme/ThemeProvider';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Refetch when the tab regains focus so links captured OUT-OF-BAND —
      // by Raycast, the Chrome extension, an agent over MCP, or another tab —
      // appear the moment you switch back to the browser, without a manual
      // reload. silo is written to from several surfaces now, and the web UI
      // otherwise has no signal for an external add (it only invalidates on its
      // OWN mutations, and the enriching poll stops once nothing is in flight),
      // so a link saved elsewhere stayed invisible until a page reload — the
      // bug this turns off. TanStack dedupes concurrent refetches, so the
      // focus refetch is cheap.
      refetchOnWindowFocus: true,
      retry: 1,
    },
  },
});

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element (#root) not found');
}

createRoot(rootElement).render(
  <StrictMode>
    {/*
      ThemeProvider stays outermost so `data-theme` is already resolved and
      the ErrorBoundary's fallback renders themed, not flashed-unstyled.
      ErrorBoundary sits just inside it so a render error anywhere in
      query/router/App (not just ThemeProvider itself) is caught.
    */}
    <ThemeProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </QueryClientProvider>
      </ErrorBoundary>
      {/* Dev-only annotation toolbar; a no-op (and tree-shaken) in production. */}
      <DevTools />
    </ThemeProvider>
  </StrictMode>,
);
