import type { PlayerEmbed } from './embedFor';

export function ReaderPlayer({ embed }: { embed: PlayerEmbed }) {
  return (
    <iframe
      className="silo-reader-player"
      data-provider={embed.provider}
      src={embed.src}
      title={embed.title}
      style={{ aspectRatio: embed.aspect, ...(embed.height ? { height: embed.height } : {}) }}
      referrerPolicy="strict-origin-when-cross-origin"
      allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
      allowFullScreen
      loading="lazy"
    />
  );
}
