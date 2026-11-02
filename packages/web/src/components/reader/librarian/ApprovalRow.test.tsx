import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ApprovalRow } from './ApprovalRow';

function show(name: string, input: unknown, expired = false) {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  for (const id of ['1', '2', '3', '4'])
    client.setQueryData(['link', id], { link: { id, title: `Title ${id}` } });
  client.setQueryData(['link', 'article'], {
    link: { title: 'Article', highlights: [{ id: 'h', quote: 'Quoted words' }] },
  });
  client.setQueryData(['feed', 'f'], { feed: { title: 'Daily feed' } });
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('unexpected fetch')));
  return render(
    <QueryClientProvider client={client}>
      <ApprovalRow
        name={name}
        input={input}
        expired={expired}
        linkId="article"
        onDecision={vi.fn()}
      />
    </QueryClientProvider>,
  );
}
afterEach(() => vi.unstubAllGlobals());
it('names three links and the remaining count', () => {
  show('trash_link', { ids: ['1', '2', '3', '4'] });
  expect(
    screen.getByRole('group', { name: 'Move “Title 1”, “Title 2”, “Title 3” +1 more to trash?' }),
  ).toBeTruthy();
});
it('names a highlighted quote and falls back when unavailable', () => {
  const view = show('delete_highlight', { id: 'h' });
  expect(screen.getByRole('group', { name: 'Delete “Quoted words”?' })).toBeTruthy();
  view.unmount();
  show('delete_highlight', { id: 'missing' });
  expect(screen.getByRole('group', { name: 'Delete a highlight?' })).toBeTruthy();
});
it('names the feed and explains post removal', () => {
  show('unsubscribe_feed', { feedId: 'f' });
  expect(
    screen.getByRole('group', {
      name: 'Unsubscribe from “Daily feed”? Its posts are removed too.',
    }),
  ).toBeTruthy();
});
it.each(['edit_link', 'edit_highlight'])(
  'names the note target and caps the preview for %s',
  (name) => {
    show(name, { id: '1', note: 'x'.repeat(100) });
    expect(
      screen.getByRole('group', {
        name: `Replace the note on “${name === 'edit_link' ? 'Title 1' : 'Article'}”?`,
      }),
    ).toBeTruthy();
    expect(screen.getByText('x'.repeat(80))).toBeTruthy();
    expect(screen.queryByText('x'.repeat(100))).toBeNull();
  },
);
it('names both merge tags', () => {
  show('rename_tag', { name: 'a', newName: 'b', merge: true });
  expect(
    screen.getByRole('group', { name: 'Merge “a” into “b”? Links keep one tag.' }),
  ).toBeTruthy();
});
it('expires an old approval without decision buttons', () => {
  show('trash_link', { id: '1' }, true);
  expect(screen.getByText('Expired. Ask again.')).toBeTruthy();
  expect(screen.queryByRole('button')).toBeNull();
});
