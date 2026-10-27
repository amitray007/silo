import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { makeLink, twitterSourceData } from '../../test/fixtures';
import { ReaderContent } from './ReaderContent';

function renderPost(postedAt?: string) {
  const link = makeLink({
    url: 'https://x.com/amitray007/status/1',
    sourceData: { ...twitterSourceData, ...(postedAt && { postedAt }) },
  });
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ReaderContent link={link} />
    </QueryClientProvider>,
  );
}

describe('TweetCard', () => {
  it('shows when the post went out', () => {
    const { container } = renderPost('Sat Oct 10 06:36:53 +0000 2026');
    const time = container.querySelector('time.silo-reader-posted');
    expect(time?.getAttribute('dateTime')).toBe('2026-10-10T06:36:53.000Z');
    expect(time?.textContent).toMatch(/2026/);
  });

  it('leaves the line out when the date is missing or unreadable', () => {
    expect(renderPost().container.querySelector('time')).toBeNull();
    expect(renderPost('soon').container.querySelector('time')).toBeNull();
  });
});
