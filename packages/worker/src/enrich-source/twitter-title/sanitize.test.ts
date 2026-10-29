import { describe, expect, it } from 'vitest';
import { postProcess } from './sanitize.js';

describe('postProcess', () => {
  const cases: [string, string, string | null][] = [
    ['keeps a clean title', 'Interfere adds a command menu', 'Interfere adds a command menu'],
    ['trims whitespace', '  Interfere adds a command menu \n', 'Interfere adds a command menu'],
    ['takes the first line', 'Interfere adds a menu\nThis title is short', 'Interfere adds a menu'],
    ['drops a Title: label', 'Title: Interfere adds a menu', 'Interfere adds a menu'],
    ['drops a lowercase label', 'title : Interfere adds a menu', 'Interfere adds a menu'],
    ['drops double quotes', '"Interfere adds a menu"', 'Interfere adds a menu'],
    ['drops curly quotes', '“Interfere adds a menu”', 'Interfere adds a menu'],
    ['drops backticks', '`Interfere adds a menu`', 'Interfere adds a menu'],
    ['drops a quoted label', '"Title: Interfere adds a menu"', 'Interfere adds a menu'],
    ['drops emojis', 'Interfere 🚀 adds a menu ✨', 'Interfere adds a menu'],
    ['drops a variation selector', 'Interfere adds a menu ❤️', 'Interfere adds a menu'],
    ['drops a ZWJ and skin-tone emoji', 'Team 👩🏽‍💻 ships code', 'Team ships code'],
    ['drops a flag', 'Team 🇯🇵 ships code', 'Team ships code'],
    ['drops a keycap', 'Team 1️⃣ ships code', 'Team ships code'],
    ['drops keycaps without a variation selector', 'Team 2\u20e3 ships code', 'Team ships code'],
    ['drops a hash prefix', '#Interfere adds a menu', 'Interfere adds a menu'],
    ['drops a handle token', '@interfere adds a menu', 'adds a menu'],
    ['drops a parenthesized handle', '(@bob)', null],
    ['drops a handle inside Japanese', '太郎が@aliceを紹介', '太郎がを紹介'],
    ['drops a hashtag inside parentheses', 'Team adds (#menus)', 'Team adds (menus)'],
    ['drops non-Latin hashtag prefixes', '太郎が #新機能 を紹介', '太郎が 新機能 を紹介'],
    ['drops a numeric hashtag prefix', 'Team ships #123', 'Team ships 123'],
    ['keeps C#', 'C# tips', 'C# tips'],
    ['keeps F#', 'F# tips', 'F# tips'],
    ['keeps an email', 'Contact bob@example.com', 'Contact bob@example.com'],
    ['keeps an email with a plus tag', 'Ask bob+news@example.co.uk', 'Ask bob+news@example.co.uk'],
    ['keeps an email with a hash', 'Ask #bob@example.com', 'Ask #bob@example.com'],
    ['drops a handle before a dotted suffix', 'Team (@bob.com)', 'Team (.com)'],
    ['drops a trailing period', 'Interfere adds a menu.', 'Interfere adds a menu'],
    ['drops a trailing bang', 'Interfere adds a menu!', 'Interfere adds a menu'],
    ['drops a trailing ellipsis', 'Interfere adds a menu…', 'Interfere adds a menu'],
    ['drops a period inside quotes', '"Interfere adds a menu."', 'Interfere adds a menu'],
    ['drops a period after quotes', '"Interfere adds a menu".', 'Interfere adds a menu'],
    ['collapses whitespace', 'Interfere   adds\ta  menu', 'Interfere adds a menu'],
    ['strips NUL', 'Interfere\u0000 adds a menu', 'Interfere adds a menu'],
    ['strips C0 and C1 controls', 'Team\u0001\u001f\u007f\u0080\u009f ships', 'Team ships'],
    ['collapses control whitespace', 'Team\t\v\f\u0085 ships', 'Team ships'],
    ['hard-cuts when a word cut is too short', `A ${'b'.repeat(80)}`, `A ${'b'.repeat(68)}`],
    ['cuts Japanese without spaces', '日'.repeat(90), '日'.repeat(70)],
    ['keeps Japanese', 'Xが動画リアクションを追加', 'Xが動画リアクションを追加'],
    ['keeps RTL Arabic', 'طارق يضيف قائمة أوامر جديدة', 'طارق يضيف قائمة أوامر جديدة'],
    ['keeps Devanagari', 'मोदी सरकार के बारह वर्ष', 'मोदी सरकार के बारह वर्ष'],
    ['rejects an empty string', '', null],
    ['rejects whitespace', '   \n  ', null],
    ['rejects under 3 characters', 'Hi', null],
    ['rejects when cleaning leaves under 3 characters', '🚀🚀 a.', null],
    ['rejects http', 'See http://evil.example now', null],
    ['rejects https', 'Read https://x.co/a', null],
    ['rejects URLs with handles and hashtags', 'Read https://x.com/@bob/#news', null],
    ['rejects www.', 'Visit www.example.com', null],
    ["rejects I can't", "I can't write a title for this", null],
    ['rejects a curly I can’t', 'I can’t write a title for this', null],
    ['rejects I cannot', 'I cannot help with that', null],
    ['rejects Sorry', 'Sorry, no title here', null],
    ['rejects a quoted refusal', '"Sorry, no title"', null],
  ];
  it.each(cases)('%s', (_name, input, expected) => {
    expect(postProcess(input)).toBe(expected);
  });

  it('keeps a title of exactly 70 characters', () => {
    const title = `${'word '.repeat(13)}word12`.slice(0, 70).trim();
    expect(title.length).toBeLessThanOrEqual(70);
    expect(postProcess(title)).toBe(title);
  });

  it('cuts a long title at the last word boundary at or before 70', () => {
    const words = Array.from({ length: 20 }, (_, i) => `word${i}`);
    const result = postProcess(words.join(' ')) ?? '';
    expect(result.length).toBeLessThanOrEqual(70);
    expect(result).toBe(words.slice(0, result.split(' ').length).join(' '));
    expect(result.split(' ').at(-1)).toMatch(/^word\d+$/);
  });

  it('cuts at a space that falls exactly on character 70', () => {
    const head = 'a'.repeat(69);
    expect(postProcess(`${head} tail`)).toBe(head);
  });

  it('cuts one very long word hard', () => {
    expect(postProcess('a'.repeat(200))?.length).toBe(70);
  });
});
