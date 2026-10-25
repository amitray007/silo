import { useEffect, useRef, useState } from 'react';
import type { PlayerEmbed } from './embedFor';
import { ReaderSkeleton, useFrameLoading } from './ReaderLoading';

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : undefined;
}

function tweetHeight(data: unknown): number | undefined {
  const message = record(data);
  const envelope = record(message?.['twttr.embed']) ?? message;
  if (
    !envelope ||
    !['twttr.private.resize', 'resize'].includes(String(envelope.method ?? envelope.type))
  )
    return undefined;
  const params = Array.isArray(envelope.params) ? envelope.params[0] : envelope.params;
  const height = (record(params) ?? envelope).height;
  return typeof height === 'number' && Number.isFinite(height) && height > 0 && height <= 10_000
    ? Math.ceil(height)
    : undefined;
}

export function ReaderPlayer({ embed, fill = false }: { embed: PlayerEmbed; fill?: boolean }) {
  const { loading, onLoad } = useFrameLoading(embed.src);
  const frame = useRef<HTMLIFrameElement>(null);
  const [size, setSize] = useState<{ src: string; height: number }>();
  useEffect(() => {
    if (embed.provider !== 'twitter') return;
    const resize = (event: MessageEvent<unknown>) => {
      if (
        event.origin !== 'https://platform.twitter.com' ||
        event.source !== frame.current?.contentWindow
      )
        return;
      const height = tweetHeight(event.data);
      if (height !== undefined) setSize({ src: embed.src, height });
    };
    window.addEventListener('message', resize);
    return () => window.removeEventListener('message', resize);
  }, [embed.provider, embed.src]);
  const height = size?.src === embed.src ? size.height : embed.height;
  return (
    <div className="silo-player-surface" aria-busy={loading}>
      <iframe
        onLoad={onLoad}
        ref={frame}
        className="silo-reader-player"
        data-provider={embed.provider}
        src={embed.src}
        title={embed.title}
        style={{
          aspectRatio: fill ? undefined : embed.aspect,
          ...(!fill && height ? { height } : {}),
        }}
        referrerPolicy="strict-origin-when-cross-origin"
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        allowFullScreen
        loading="lazy"
      />
      {loading && (
        <div className="silo-frame-loading">
          <ReaderSkeleton label="Loading player..." />
        </div>
      )}
    </div>
  );
}
