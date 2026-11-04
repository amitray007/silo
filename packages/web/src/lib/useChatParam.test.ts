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
