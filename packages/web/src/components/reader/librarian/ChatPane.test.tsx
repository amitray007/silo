import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { expect, it, vi } from 'vitest';
import { ChatPane } from './ChatPane';
import type { Composer } from './ChatThread';

vi.mock('../../../api/librarian', () => ({
  useLibrarianAllChats: () => ({}),
  useLibrarianChatDetail: () => ({}),
  useArticleChips: () => [],
  useLibraryChips: () => [],
}));
vi.mock('./useLibrarianChat', () => ({
  useLibrarianPageChat: () => ({ title: 'New chat' }),
}));
vi.mock('./ChatThread', async (original) => ({
  ...(await original<typeof import('./ChatThread')>()),
  ChatThread: ({ composer }: { composer: Composer }) => (
    <textarea aria-label="Composer" ref={composer.field} />
  ),
}));

it('focuses a new composer only when requested', () => {
  const view = (autoFocus: boolean) => (
    <MemoryRouter>
      <ChatPane chatId={null} autoFocus={autoFocus} onBack={() => {}} onCreated={() => {}} />
    </MemoryRouter>
  );
  const { rerender } = render(view(false));
  expect(document.activeElement).not.toBe(screen.getByRole('textbox'));
  rerender(view(true));
  expect(document.activeElement).toBe(screen.getByRole('textbox'));
});
