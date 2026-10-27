import type { MouseEvent } from 'react';
import type { SourceData } from '../../api/types';
import type { PlayerEmbed } from './embedFor';

function durationLabel(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = String(seconds % 60).padStart(2, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
}

export function YouTubeStats({ source }: { source: SourceData }) {
  if (source.kind !== 'youtube') return null;
  const stats = [
    source.channel,
    source.views === undefined ? undefined : `${source.views.toLocaleString()} views`,
    source.duration === undefined ? undefined : durationLabel(source.duration),
    source.publishedAt?.slice(0, 10),
  ];
  return <p className="silo-youtube-stats">{stats.filter(Boolean).join(' · ')}</p>;
}

/** Only chapters for this video's allowlisted watch URL can command its own player. */
export function seekChapter(event: MouseEvent<HTMLElement>, embed: PlayerEmbed | undefined) {
  if (
    embed?.provider !== 'youtube' ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    event.altKey ||
    event.button !== 0
  )
    return;
  const anchor = (event.target as Element).closest('a');
  if (!anchor) return;
  const url = new URL(anchor.href);
  const playerUrl = new URL(embed.src);
  if (
    url.origin !== 'https://www.youtube.com' ||
    url.pathname !== '/watch' ||
    url.searchParams.get('v') !== playerUrl.pathname.split('/').pop()
  )
    return;
  const time = /^(\d+)s?$/.exec(url.searchParams.get('t') ?? '');
  if (!time) return;
  const seconds = Number(time[1]);
  if (!Number.isSafeInteger(seconds)) return;
  const player = event.currentTarget.querySelector<HTMLIFrameElement>(
    'iframe[data-provider="youtube"]',
  );
  if (!player?.contentWindow) return;
  event.preventDefault();
  player.contentWindow.postMessage(
    JSON.stringify({ event: 'command', func: 'seekTo', args: [seconds, true] }),
    'https://www.youtube-nocookie.com',
  );
  player.scrollIntoView({ block: 'nearest' });
}
