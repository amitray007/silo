import { describe, expect, it } from 'vitest';
import { extractYouTubeWatch } from './youtube-watch.js';

const url = 'https://www.youtube.com/watch?v=abcdefghijk';
const page = (data: unknown) =>
  `<script>var ytInitialPlayerResponse = ${JSON.stringify(data)}; var other={};</script>`;
describe('YouTube watch-page JSON', () => {
  it('reads full description and microformat, preserving paragraphs, links and chapters safely', () => {
    const text = `A long description ${'words '.repeat(100)}\n\n0:00 Intro\n1:02:03 Deep dive https://site.test/a?x=1&y=2 <img src=x onerror=evil()>`;
    const result = extractYouTubeWatch(
      page({
        videoDetails: {
          videoId: 'abcdefghijk',
          shortDescription: text,
          author: 'Channel',
          lengthSeconds: '4000',
          viewCount: '1234567',
          keywords: ['one', 'two'],
        },
        microformat: {
          playerMicroformatRenderer: { publishDate: '2026-01-02', uploadDate: '2026-01-01' },
        },
      }),
      url,
    );
    expect(result?.text).toBe(text);
    expect(result?.sourceData).toMatchObject({
      channel: 'Channel',
      duration: 4000,
      views: 1234567,
      publishedAt: '2026-01-02',
      keywords: ['one', 'two'],
    });
    expect(result?.reader?.contentHtml).toContain('t=3723s');
    expect(result?.reader?.contentHtml).toContain('t=0s');
    expect(result?.reader?.contentHtml).toContain('href="https://site.test/a?x=1&amp;y=2"');
    expect(result?.reader?.contentHtml).not.toContain('<img');
  });
  it('handles malformed JSON, strings containing braces, missing details and other sites', () => {
    expect(
      extractYouTubeWatch('<script>ytInitialPlayerResponse = {bad};</script>', url),
    ).toBeUndefined();
    expect(extractYouTubeWatch(page({}), url)).toBeUndefined();
    expect(
      extractYouTubeWatch(
        page({ videoDetails: { videoId: 'abcdefghijk', shortDescription: 'a } "quoted" { b' } }),
        url,
      )?.text,
    ).toBe('a } "quoted" { b');
    expect(extractYouTubeWatch(page({}), 'https://other.test')).toBeUndefined();
  });
});
