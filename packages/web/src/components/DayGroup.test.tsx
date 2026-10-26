import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { HoverPreviewProvider } from '../components/HoverPreviewContext';
import { RowMenuProvider } from '../components/RowMenuContext';
import { makeLink as link } from '../test/fixtures';
import { DayGroup } from './DayGroup';

/** Rows need menu, hover-preview, and query providers. */
function renderWithProviders(ui: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <RowMenuProvider>
        <HoverPreviewProvider>{ui}</HoverPreviewProvider>
      </RowMenuProvider>
    </QueryClientProvider>,
  );
}

describe('DayGroup', () => {
  it('renders the label in the token style', () => {
    renderWithProviders(<DayGroup label="Today" links={[]} />);
    const label = screen.getByText('Today');
    expect(label.className).toBe('silo-daylabel');
  });

  it('renders one LinkRow per link, in order', () => {
    const links = [link({ id: 'a', title: 'First' }), link({ id: 'b', title: 'Second' })];
    renderWithProviders(<DayGroup label="Today" links={links} />);
    const titles = screen.getAllByRole('link').map((a) => a.textContent);
    expect(titles[0]).toContain('First');
    expect(titles[1]).toContain('Second');
  });

  it('renders just the label when there are no links', () => {
    renderWithProviders(<DayGroup label="Earlier" links={[]} />);
    expect(screen.getByText('Earlier')).toBeDefined();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });
});
