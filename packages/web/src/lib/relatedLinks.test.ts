import { describe, expect, it } from 'vitest';
import { extractRelatedLinks } from './relatedLinks';

const article = 'https://article.test/story/';

describe('extractRelatedLinks', () => {
  it('keeps first-seen order and text, removes hashes, and deduplicates URLs', () => {
    expect(
      extractRelatedLinks(
        '<a href="https://other.test/a#one">  First <b> useful </b> title\n </a>' +
          '<a href="https://other.test/b">Second title</a>' +
          '<a href="https://other.test/a#two">Duplicate title</a>',
        article,
      ),
    ).toEqual([
      { url: 'https://other.test/a', title: 'First useful title', hostname: 'other.test' },
      { url: 'https://other.test/b', title: 'Second title', hostname: 'other.test' },
    ]);
  });

  it('filters empty, fragment, non-web, and invalid links', () => {
    const html = [
      '',
      '#footnote',
      'mailto:a@b.test',
      'tel:123',
      'javascript:alert(1)',
      'data:text/html,x',
      'ftp://other.test/file',
      'https://[bad',
    ]
      .map((href) => `<a href="${href}">Filtered</a>`)
      .join('');
    expect(extractRelatedLinks(`${html}<a>No href</a>`, article)).toEqual([]);
    expect(extractRelatedLinks('<p>No anchors</p>', article)).toEqual([]);
  });

  it('removes self links by host and path ignoring protocol, queries, hashes, and trailing slashes', () => {
    expect(
      extractRelatedLinks(
        '<a href="http://ARTICLE.test/story?ref=x#part">Self</a>' +
          '<a href="https://article.test/story/">Self too</a>' +
          '<a href="https://article.test/other">Other page</a>' +
          '<a href="https://different.test/story/">Other host</a>',
        article,
      ).map((link) => link.url),
    ).toEqual(['https://article.test/other', 'https://different.test/story/']);
  });

  it.each([
    '',
    'ab',
    'HERE',
    'link',
    'this',
    'click here',
    'Read   more',
    'source',
    'https://other.test/label',
    'www.other.test/label',
    'other.test/label',
  ])('falls back to hostname and path for weak title %j', (title) => {
    expect(
      extractRelatedLinks(`<a href="https://other.test/path/?q=1">${title}</a>`, article)[0]?.title,
    ).toBe('other.test/path');
  });

  it('resolves relative links against the article, ignoring publisher base tags', () => {
    expect(
      extractRelatedLinks(
        '<base href="https://wrong.test"><a href="../reference">Reference</a>',
        article,
      ),
    ).toEqual([
      { url: 'https://article.test/reference', title: 'Reference', hostname: 'article.test' },
    ]);
  });

  it('caps at 20 unique included links after filtering and deduplication', () => {
    const html =
      '<a href="#skip">Skip</a>' +
      Array.from(
        { length: 25 },
        (_, index) =>
          `<a href="https://other.test/${index}">Title ${index}</a><a href="https://other.test/${index}#dup">Duplicate</a>`,
      ).join('');
    const links = extractRelatedLinks(html, article);
    expect(links).toHaveLength(20);
    expect(links[19]?.url).toBe('https://other.test/19');
  });
});
