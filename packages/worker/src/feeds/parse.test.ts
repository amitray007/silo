import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FEED_MAX_BODY_BYTES, parseFeedBody } from './parse.js';

const podcast = readFileSync(new URL('./__fixtures__/podcast.xml', import.meta.url), 'utf8');
const base = 'https://example.com/feed';
const audio = 'https://audio.example.com/episode.mp3?download=1&source=feed';
const rss = (item: string) =>
  `<rss version="2.0"><channel><title>Feed</title>${item}</channel></rss>`;

describe('podcast entry URLs and publisher content', () => {
  it('uses the enclosure for a Megaphone-style item without a link and keeps GUID identity', () => {
    expect(parseFeedBody(podcast, base)?.entries[0]).toMatchObject({
      id: 'episode-123',
      url: audio,
      title: 'A conversation & a question',
      publishedAt: new Date('2026-10-29T10:00:00Z'),
      media: {
        kind: 'feed_media',
        enclosureUrl: audio,
        description: 'A short summary.',
        content: expect.stringContaining('These are the searchable show notes.'),
        imageUrl: 'https://example.com/episode.jpg',
      },
    });
  });

  it.each([
    ['<link>/article</link><guid>https://example.com/guid</guid>', 'https://example.com/article'],
    [
      '<link>javascript:alert(1)</link><guid>https://example.com/guid</guid>',
      'https://example.com/guid',
    ],
    ['<guid isPermaLink="true">https://example.com/guid</guid>', 'https://example.com/guid'],
    ['<guid>https://example.com/default-permalink</guid>', 'https://example.com/default-permalink'],
    [
      '<guid isPermaLink="false">https://example.com/not-a-link</guid>',
      'https://example.com/audio.mp3',
    ],
    ['<guid>opaque-id</guid>', 'https://example.com/audio.mp3'],
    ['<guid>/relative-id</guid>', 'https://example.com/audio.mp3'],
  ])('chooses link, HTTP permalink GUID, then enclosure: %s', (identity, expected) => {
    const item = `<item>${identity}<enclosure url="/audio.mp3" type="audio/mpeg"/></item>`;
    expect(parseFeedBody(rss(item), base)?.entries[0]?.url).toBe(expected);
  });

  it('keeps a permalink-only article on the ordinary page pipeline', () => {
    expect(
      parseFeedBody(rss('<item><guid>https://example.com/article</guid></item>'), base)?.entries[0],
    ).toEqual({
      id: 'https://example.com/article',
      url: 'https://example.com/article',
      publishedAt: null,
    });
    expect(
      parseFeedBody(
        rss('<item><guid isPermaLink="false">https://example.com/id</guid></item>'),
        base,
      )?.entries,
    ).toEqual([]);
  });

  it('uses Atom enclosure links and preserves text constructs as text', () => {
    const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><title>Audio</title><entry><id>urn:episode:1</id><title>Atom episode</title><link rel="enclosure" href="/episode.ogg" type="audio/ogg"/><summary type="text">A &lt;b&gt;literal&lt;/b&gt; summary</summary><content type="html">&lt;p&gt;Atom show notes&lt;/p&gt;</content></entry></feed>`;
    expect(parseFeedBody(atom, base)?.entries[0]).toMatchObject({
      id: 'urn:episode:1',
      url: 'https://example.com/episode.ogg',
      media: { content: '<p>Atom show notes</p>', description: 'A <b>literal</b> summary' },
    });
  });

  it('uses JSON Feed attachments and keeps an explicit page URL ahead of the audio', () => {
    const item = {
      id: 'json-episode',
      title: 'JSON episode',
      content_text: '<literal> & notes',
      summary: 'Episode summary',
      image: '/cover.jpg',
      attachments: [{ url: '/episode.mp3', mime_type: 'audio/mpeg' }],
    };
    const feed = (extra = {}) =>
      JSON.stringify({
        version: 'https://jsonfeed.org/version/1.1',
        title: 'Podcast',
        items: [{ ...item, ...extra }],
      });
    expect(parseFeedBody(feed(), base)?.entries[0]).toMatchObject({
      id: 'json-episode',
      url: 'https://example.com/episode.mp3',
      media: { content: '&lt;literal&gt; &amp; notes', imageUrl: 'https://example.com/cover.jpg' },
    });
    expect(parseFeedBody(feed({ url: '/page' }), base)?.entries[0]).toMatchObject({
      url: 'https://example.com/page',
      media: { enclosureUrl: 'https://example.com/episode.mp3' },
    });
  });

  it('falls back to Media RSS content and its thumbnail, including grouped content', () => {
    const body = `<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>Video</title><item><guid isPermaLink="false">video-1</guid><description>Video notes</description><media:group><media:content url="/episode.mp4" type="video/mp4"/><media:thumbnail url="/cover.jpg"/></media:group></item></channel></rss>`;
    expect(parseFeedBody(body, base)?.entries[0]).toMatchObject({
      url: 'https://example.com/episode.mp4',
      media: { content: 'Video notes', imageUrl: 'https://example.com/cover.jpg' },
    });
  });

  it('marks an enclosure fallback as media even without a MIME type; ignores unsafe enclosures', () => {
    expect(
      parseFeedBody(rss('<item><enclosure url="/audio"/></item>'), base)?.entries[0]?.media?.kind,
    ).toBe('feed_media');
    expect(
      parseFeedBody(rss('<item><enclosure url="javascript:alert(1)"/></item>'), base)?.entries,
    ).toEqual([]);
  });

  it('rejects DTDs before expansion and bodies over the feed cap', () => {
    expect(
      parseFeedBody(
        '<!DOCTYPE rss [<!ENTITY a "expanded">]>' +
          rss('<item><link>/x</link><title>&a;</title></item>'),
        base,
      ),
    ).toBeNull();
    expect(parseFeedBody(' '.repeat(FEED_MAX_BODY_BYTES + 1), base)).toBeNull();
  });

  it('bounds publisher content without leaving half an emoji for Postgres JSONB', () => {
    const content = `${'a'.repeat(1_048_575)}😀extra`;
    const description = `${'b'.repeat(19_999)}😀extra`;
    const body = JSON.stringify({
      version: 'https://jsonfeed.org/version/1.1',
      title: 'Podcast',
      items: [
        {
          id: 'long',
          content_html: content,
          summary: description,
          attachments: [{ url: '/audio.mp3', mime_type: 'audio/mpeg' }],
        },
      ],
    });
    const media = parseFeedBody(body, base)?.entries[0]?.media;
    expect(media?.content).toHaveLength(1_048_575);
    expect(media?.description).toHaveLength(19_999);
    expect(media?.content.endsWith('a')).toBe(true);
    expect(media?.description?.endsWith('b')).toBe(true);
  });
});
