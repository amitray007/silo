import { describe, expect, it } from 'vitest';
import { type PostToken, tokenizePostText } from './postText';

/** Compact view: links as `[value -> href]`, text as itself. */
function show(text: string): string[] {
  return tokenizePostText(text).map((token: PostToken) =>
    token.type === 'text' ? token.value : `[${token.value} -> ${token.href}]`,
  );
}

describe('tokenizePostText', () => {
  it('returns plain text as one token and nothing for empty text', () => {
    expect(show('just words')).toEqual(['just words']);
    expect(show('')).toEqual([]);
  });

  it('links a URL and keeps the sentence period out of it', () => {
    expect(show('Read https://aiengg.dev/blog/post-1.')).toEqual([
      'Read ',
      '[https://aiengg.dev/blog/post-1 -> https://aiengg.dev/blog/post-1]',
      '.',
    ]);
  });

  it('trims other trailing punctuation but keeps query strings and fragments', () => {
    expect(show('see https://a.com/x?y=1#top!?, ok')[1]).toBe(
      '[https://a.com/x?y=1#top -> https://a.com/x?y=1#top]',
    );
    expect(show('"https://a.com/x"')).toEqual(['"', '[https://a.com/x -> https://a.com/x]', '"']);
  });

  it('leaves out a closing parenthesis that is not part of the URL', () => {
    expect(show('(see https://a.com/x)')).toEqual([
      '(see ',
      '[https://a.com/x -> https://a.com/x]',
      ')',
    ]);
  });

  it('keeps a balanced parenthesis inside the URL', () => {
    expect(show('https://en.wikipedia.org/wiki/Foo_(bar).')).toEqual([
      '[https://en.wikipedia.org/wiki/Foo_(bar) -> https://en.wikipedia.org/wiki/Foo_(bar)]',
      '.',
    ]);
  });

  it('links several URLs and keeps line breaks in the text between them', () => {
    expect(show('one https://a.com\ntwo http://b.org/p, three')).toEqual([
      'one ',
      '[https://a.com -> https://a.com/]',
      '\ntwo ',
      '[http://b.org/p -> http://b.org/p]',
      ', three',
    ]);
  });

  it('links @handles to x.com and keeps the @ in the label', () => {
    expect(show('thanks @ClaudeAI, and @dev_1!')).toEqual([
      'thanks ',
      '[@ClaudeAI -> https://x.com/ClaudeAI]',
      ', and ',
      '[@dev_1 -> https://x.com/dev_1]',
      '!',
    ]);
  });

  it('links #hashtags to the x.com hashtag page', () => {
    expect(show('#AI is here, #claude_code')).toEqual([
      '[#AI -> https://x.com/hashtag/AI]',
      ' is here, ',
      '[#claude_code -> https://x.com/hashtag/claude_code]',
    ]);
    expect(show('#日本語')[0]).toBe(
      `[#日本語 -> https://x.com/hashtag/${encodeURIComponent('日本語')}]`,
    );
  });

  it('does not link an email address or a handle that starts inside a word', () => {
    expect(show('mail me: amit@example.com or a@b')).toEqual(['mail me: amit@example.com or a@b']);
    expect(show('issue#12 and word#tag')).toEqual(['issue#12 and word#tag']);
  });

  it('does not link all-digit hashtags or handles longer than 15 characters', () => {
    expect(show('#123 and @abcdefghijklmnop')).toEqual(['#123 and @abcdefghijklmnop']);
  });

  it('does not treat the path of a URL as a separate handle or hashtag', () => {
    expect(show('https://x.com/@jack/status/1#frag')).toEqual([
      '[https://x.com/@jack/status/1#frag -> https://x.com/@jack/status/1#frag]',
    ]);
  });

  it('never links javascript:, data: or other schemes', () => {
    for (const text of [
      'javascript:alert(1)',
      'click JAVASCRIPT:alert(1)',
      'data:text/html,<script>1</script>',
      'ftp://a.com/x',
      'vbscript:x',
      'file:///etc/passwd',
    ]) {
      expect(
        tokenizePostText(text).every((token) => token.type === 'text'),
        text,
      ).toBe(true);
    }
  });

  it('links a javascript: look-alike only as plain text inside a real URL', () => {
    const tokens = tokenizePostText('https://a.com/?u=javascript:alert(1)');
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ type: 'link', kind: 'url' });
  });

  it('ignores a scheme with no address and stops a URL at CJK punctuation', () => {
    expect(show('https:// and https://.')).toEqual(['https:// and https://.']);
    expect(show('见https://a.com/x。好')).toEqual([
      '见',
      '[https://a.com/x -> https://a.com/x]',
      '。好',
    ]);
  });

  it('rebuilds the original text from its tokens', () => {
    const text = 'Hi @a, see (https://a.com/x). #tag\nnext line https://b.org!';
    const rebuilt = tokenizePostText(text)
      .map((token) => token.value)
      .join('');
    expect(rebuilt).toBe(text);
  });

  it('links whole hashtags in scripts with combining marks', () => {
    expect(show('#नमस्ते')).toEqual([
      `[#नमस्ते -> https://x.com/hashtag/${encodeURIComponent('नमस्ते')}]`,
    ]);
  });

  it('never links a URL with a user name, and stops at invisible format characters', () => {
    expect(show('see https://x.com@evil.com/path')).toEqual(['see https://x.com@evil.com/path']);
    expect(show('https://a.com/x\u202Egnp.exe')).toEqual([
      '[https://a.com/x -> https://a.com/x]',
      '\u202Egnp.exe',
    ]);
  });
});
