import type { SourceData } from '../../api/types';

type Provider = 'youtube' | 'vimeo' | 'twitter' | 'loom' | 'spotify' | 'codepen' | 'figma';
export type PlayerEmbed = {
  provider: Provider;
  src: string;
  title: string;
  aspect: string;
  height?: number;
  /** A video provider: the reader shows it as the post's player and can seek its chapters. */
  video: boolean;
};
type ProviderEmbed = Omit<PlayerEmbed, 'video'>;
const videoProviders: readonly Provider[] = ['youtube', 'vimeo', 'loom'];

const youtubeId = /^[\w-]{11}$/;
function startSeconds(value: string | null): number | undefined {
  if (!value) return undefined;
  if (/^\d+$/.test(value)) return Number.isSafeInteger(Number(value)) ? Number(value) : undefined;
  const parts = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(value);
  if (!parts) return undefined;
  const seconds = Number(parts[1] ?? 0) * 3600 + Number(parts[2] ?? 0) * 60 + Number(parts[3] ?? 0);
  return Number.isSafeInteger(seconds) ? seconds : undefined;
}

function youtube(url: URL, source: SourceData): ProviderEmbed | undefined {
  const short = url.hostname === 'youtu.be';
  const path = /^\/(?:shorts|embed|live)\/([\w-]+)\/?$/.exec(url.pathname);
  let id = short ? /^\/([\w-]+)\/?$/.exec(url.pathname)?.[1] : path?.[1];
  if (!short && url.pathname === '/watch')
    id = url.searchParams.get('v') ?? (source.kind === 'youtube' ? source.videoId : undefined);
  if (!id || !youtubeId.test(id)) return undefined;
  const src = new URL(`https://www.youtube-nocookie.com/embed/${id}`);
  src.searchParams.set('enablejsapi', '1');
  const start = startSeconds(url.searchParams.get('t') ?? url.searchParams.get('start'));
  if (start !== undefined) src.searchParams.set('start', String(start));
  return { provider: 'youtube', src: src.href, title: 'YouTube video', aspect: '16 / 9' };
}

function vimeo(url: URL): ProviderEmbed | undefined {
  const match = /^\/(?:video\/)?([1-9]\d{0,11})(?:\/([a-f\d]{10}))?\/?$/.exec(url.pathname);
  if (!match) return undefined;
  const hash = match[2] ?? url.searchParams.get('h');
  if (hash && !/^[a-f\d]{10}$/.test(hash)) return undefined;
  const src = new URL(`https://player.vimeo.com/video/${match[1]}`);
  if (hash) src.searchParams.set('h', hash);
  return { provider: 'vimeo', src: src.href, title: 'Vimeo video', aspect: '16 / 9' };
}

function otherEmbed(url: URL): ProviderEmbed | undefined {
  const host = url.hostname;
  if (['loom.com', 'www.loom.com'].includes(host)) {
    const id = /^\/(?:share|embed)\/([a-f\d]{32})\/?$/.exec(url.pathname)?.[1];
    if (id)
      return {
        provider: 'loom',
        src: `https://www.loom.com/embed/${id}`,
        title: 'Loom video',
        aspect: '4 / 3',
      };
  }
  if (host === 'open.spotify.com') {
    const path = /^\/(?:embed\/)?(track|album|playlist|episode|show)\/([A-Za-z\d]{22})\/?$/.exec(
      url.pathname,
    );
    if (path)
      return {
        provider: 'spotify',
        src: `https://open.spotify.com/embed/${path[1]}/${path[2]}`,
        title: 'Spotify player',
        aspect: 'auto',
        height: path[1] === 'track' ? 152 : 352,
      };
  }
  if (host === 'codepen.io') {
    const path = /^\/([\w-]+)\/(?:pen|embed)\/([A-Za-z\d]{3,12})\/?$/.exec(url.pathname);
    if (path)
      return {
        provider: 'codepen',
        src: `https://codepen.io/${path[1]}/embed/${path[2]}`,
        title: 'CodePen preview',
        aspect: '4 / 3',
        height: 450,
      };
  }
  return figma(url);
}

function figma(url: URL): ProviderEmbed | undefined {
  if (!['figma.com', 'www.figma.com', 'embed.figma.com'].includes(url.hostname)) return undefined;
  const path = /^\/(design|file|board|proto)\/([A-Za-z\d]{10,128})(?:\/[^/]*)?\/?$/.exec(
    url.pathname,
  );
  if (!path) return undefined;
  const src = new URL(
    `https://embed.figma.com/${path[1] === 'file' ? 'design' : path[1]}/${path[2]}`,
  );
  for (const name of [
    'node-id',
    'page-id',
    'starting-point-node-id',
    'scaling',
    'content-scaling',
  ]) {
    const value = url.searchParams.get(name);
    if (value && /^[\w:.,-]{1,100}$/.test(value)) src.searchParams.set(name, value);
  }
  src.searchParams.set('embed-host', 'silo');
  return {
    provider: 'figma',
    src: src.href,
    title: 'Figma document',
    aspect: '4 / 3',
    height: 450,
  };
}

function resolveEmbed(
  rawUrl: string,
  sourceData: SourceData,
  theme: 'light' | 'dark',
): ProviderEmbed | undefined {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return undefined;
  }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port)
    return undefined;
  if (
    [
      'youtube.com',
      'www.youtube.com',
      'm.youtube.com',
      'youtu.be',
      'www.youtube-nocookie.com',
    ].includes(url.hostname)
  )
    return youtube(url, sourceData);
  if (['vimeo.com', 'www.vimeo.com', 'player.vimeo.com'].includes(url.hostname)) return vimeo(url);
  if (
    ['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com'].includes(
      url.hostname,
    )
  ) {
    const id = /^\/[A-Za-z\d_]{1,15}\/status\/([1-9]\d{0,19})\/?$/.exec(url.pathname)?.[1];
    if (id)
      return {
        provider: 'twitter',
        src: `https://platform.twitter.com/embed/Tweet.html?id=${id}&theme=${theme}`,
        title: 'X post',
        aspect: 'auto',
        height: 250,
      };
    return undefined;
  }
  return otherEmbed(url);
}

/** Construct trusted player URLs; never render HTML returned by a provider. */
export function embedFor(
  rawUrl: string,
  sourceData: SourceData,
  theme: 'light' | 'dark' = 'light',
): PlayerEmbed | undefined {
  const embed = resolveEmbed(rawUrl, sourceData, theme);
  return embed && { ...embed, video: videoProviders.includes(embed.provider) };
}
