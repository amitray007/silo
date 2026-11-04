import { fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { Link, MemoryRouter, useLocation } from 'react-router';
import { expect, it } from 'vitest';
import { chatTo, NEW_CHAT } from './useChatParam';

const at = (pathname: string, search = '') => ({ pathname, search });

it('opens a chat beside the current list and keeps the list state', () => {
  expect(chatTo(at('/', '?q=x'), 'c1')).toBe('/?q=x&chat=c1');
  expect(chatTo(at('/tags/ai'), 'c1')).toBe('/tags/ai?chat=c1');
  expect(chatTo(at('/feeds/f1'), NEW_CHAT)).toBe('/feeds/f1?chat=new');
  expect(chatTo(at('/librarian', '?chat=c0'), 'c1')).toBe('/librarian?chat=c1');
});

it('drops an open link so the chat shows', () => {
  expect(chatTo(at('/', '?link=a'), 'c1')).toBe('/?chat=c1');
});

it('falls back to the Librarian page where no list can hold a chat', () => {
  expect(chatTo(at('/trash', '?link=a'), 'c1')).toBe('/librarian?chat=c1');
  expect(chatTo(at('/settings/ai'), 'c1')).toBe('/librarian?chat=c1');
});

it.each(['/feeds/missing/extra', '/tags/ai/extra', '/tags', '/feeds-extra'])(
  'leaves invalid chat host %s for Librarian',
  (path) => {
    expect(chatTo(at(path, '?q=x'), 'c1')).toBe('/librarian?chat=c1');
  },
);

function ChatNavigation() {
  const location = useLocation();
  return createElement(
    'div',
    null,
    createElement(Link, { to: chatTo(location, 'c1') }, 'Open chat'),
    createElement('output', { 'data-testid': 'location' }, location.pathname + location.search),
  );
}

it('opens sidebar chats on Librarian from a missing nested feed route', () => {
  render(
    createElement(
      MemoryRouter,
      { initialEntries: ['/feeds/missing/extra'] },
      createElement(ChatNavigation),
    ),
  );
  fireEvent.click(screen.getByRole('link', { name: 'Open chat' }));
  expect(screen.getByTestId('location').textContent).toBe('/librarian?chat=c1');
});
