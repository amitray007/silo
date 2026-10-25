import { describe, expect, it } from 'vitest';
import { embedFor } from './embedFor';

const source = { kind: 'link' } as const;
const yt = 'https://www.youtube-nocookie.com/embed/jNQXAC9IVRw';
describe('embedFor', () => {
  it.each([
    ['https://www.youtube.com/watch?v=jNQXAC9IVRw', 'youtube', yt],
    ['https://youtu.be/jNQXAC9IVRw?t=90', 'youtube', `${yt}?start=90`],
    ['https://m.youtube.com/shorts/jNQXAC9IVRw?t=1m30s', 'youtube', `${yt}?start=90`],
    ['https://youtube.com/embed/jNQXAC9IVRw?t=1h2m3s', 'youtube', `${yt}?start=3723`],
    ['https://youtube.com/live/jNQXAC9IVRw?t=oops', 'youtube', yt],
    ['https://www.youtube-nocookie.com/embed/jNQXAC9IVRw?start=0', 'youtube', `${yt}?start=0`],
    ['https://vimeo.com/76979871', 'vimeo', 'https://player.vimeo.com/video/76979871'],
    [
      'https://vimeo.com/76979871/abcdef1234',
      'vimeo',
      'https://player.vimeo.com/video/76979871?h=abcdef1234',
    ],
    [
      'https://player.vimeo.com/video/76979871?h=abcdef1234',
      'vimeo',
      'https://player.vimeo.com/video/76979871?h=abcdef1234',
    ],
    [
      'https://x.com/karpathy/status/1886192184808149383',
      'twitter',
      'https://platform.twitter.com/embed/Tweet.html?id=1886192184808149383&theme=dark',
    ],
    [
      'https://twitter.com/karpathy/status/1886192184808149383',
      'twitter',
      'https://platform.twitter.com/embed/Tweet.html?id=1886192184808149383&theme=dark',
    ],
    [
      'https://www.loom.com/share/1234567890abcdef1234567890abcdef',
      'loom',
      'https://www.loom.com/embed/1234567890abcdef1234567890abcdef',
    ],
    [
      'https://codepen.io/chriscoyier/pen/poNYoEr',
      'codepen',
      'https://codepen.io/chriscoyier/embed/poNYoEr',
    ],
    [
      'https://www.figma.com/file/AbCdEfGhIjKlMnOpQrStUv/Design?node-id=1%3A2',
      'figma',
      'https://embed.figma.com/design/AbCdEfGhIjKlMnOpQrStUv?node-id=1%3A2&embed-host=silo',
    ],
    ...['design', 'board', 'proto'].map((type) => [
      `https://www.figma.com/${type}/AbCdEfGhIjKlMnOpQrStUv/Design`,
      'figma',
      `https://embed.figma.com/${type}/AbCdEfGhIjKlMnOpQrStUv?embed-host=silo`,
    ]),
    ...['track', 'album', 'playlist', 'episode', 'show'].map((type) => [
      `https://open.spotify.com/${type}/4uLU6hMCjMI75M1A2tKUQC`,
      'spotify',
      `https://open.spotify.com/embed/${type}/4uLU6hMCjMI75M1A2tKUQC`,
    ]),
  ])('%s', (url, provider, src) => {
    expect(embedFor(url ?? '', source, 'dark')).toMatchObject({
      provider,
      src,
      title: expect.any(String),
      aspect: expect.any(String),
    });
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html,bad',
    'not a URL',
    'https://youtube.com.attacker.org/watch?v=jNQXAC9IVRw',
    'https://youtube.com@attacker.org/watch?v=jNQXAC9IVRw',
    'https://attacker.org/watch?v=jNQXAC9IVRw',
    'https://youtube.com:444/watch?v=jNQXAC9IVRw',
    'https://user:pass@youtube.com/watch?v=jNQXAC9IVRw',
    'https://youtube.com/watch?v=short',
    'https://youtube.com/shorts/jNQXAC9IVRw/extra',
    'https://vimeo.com.attacker.org/76979871',
    'https://x.com.attacker.org/karpathy/status/1886192184808149383',
    'https://loom.com.attacker.org/share/1234567890abcdef1234567890abcdef',
    'https://open.spotify.com.attacker.org/track/4uLU6hMCjMI75M1A2tKUQC',
    'https://codepen.io.attacker.org/chriscoyier/pen/poNYoEr',
    'https://vimeo.com/abc',
    'https://vimeo.com/76979871/invalid',
    'https://x.com/karpathy/status/0',
    'https://x.com/karpathy/status/not-an-id',
    'https://www.loom.com/share/bad',
    'https://open.spotify.com/user/4uLU6hMCjMI75M1A2tKUQC',
    'https://open.spotify.com/track/bad',
    'https://codepen.io/a/pen/a<script>',
    'https://figma.com/design/bad/Design',
    'https://figma.com.attacker.org/design/AbCdEfGhIjKlMnOpQrStUv',
  ])('rejects %s', (url) => expect(embedFor(url, source)).toBeUndefined());

  it('uses a stored video id only on an allowed YouTube watch URL', () => {
    const data = {
      kind: 'youtube',
      channel: 'Channel',
      thumbnailUrl: '',
      videoId: 'jNQXAC9IVRw',
    } as const;
    expect(embedFor('https://youtube.com/watch', data)?.src).toBe(yt);
    expect(embedFor('https://attacker.org/watch', data)).toBeUndefined();
    expect(embedFor('https://youtube.com/watch?v=bad', data)).toBeUndefined();
  });
  it('sets provider dimensions and a deterministic default theme', () => {
    expect(
      embedFor('https://loom.com/share/1234567890abcdef1234567890abcdef', source)?.aspect,
    ).toBe('4 / 3');
    expect(embedFor('https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC', source)?.height).toBe(
      152,
    );
    expect(embedFor('https://open.spotify.com/album/4uLU6hMCjMI75M1A2tKUQC', source)?.height).toBe(
      352,
    );
    expect(embedFor('https://x.com/karpathy/status/1886192184808149383', source)?.src).toContain(
      'theme=light',
    );
  });
});
