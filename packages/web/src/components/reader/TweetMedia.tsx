import { useRef, useState } from 'react';
import { apiUrl } from '../../api/client';
import { useMediaQuery } from '../../lib/breakpoints';
import { ImageViewer } from './ImageViewer';
import { VideoPlayer } from './VideoPlayer';

type Item = { index: number; kind: 'photo' | 'video' | 'gif' };

/** X serves photos from pbs.twimg.com and video (GIFs included) from video.twimg.com. */
function mediaKind(url: string): Item['kind'] | undefined {
  try {
    const { hostname, pathname } = new URL(url);
    if (hostname === 'pbs.twimg.com') return 'photo';
    if (hostname === 'video.twimg.com')
      return pathname.startsWith('/tweet_video/') ? 'gif' : 'video';
  } catch {
    // Unparseable stored URLs simply do not render.
  }
  return undefined;
}

/** GIFs loop like on X, but stay still under reduced motion and pause on click. */
function TweetGif({ src }: { src: string }) {
  const still = useMediaQuery('(prefers-reduced-motion: reduce)');
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(!still);
  return (
    <button
      type="button"
      className="silo-tweet-gif"
      aria-label={playing ? 'Pause GIF' : 'Play GIF'}
      aria-pressed={playing}
      onClick={() => {
        const element = video.current;
        if (!element) return;
        if (element.paused) void element.play().catch(() => {});
        else element.pause();
      }}
    >
      <video
        ref={video}
        className="silo-tweet-video"
        src={src}
        preload="auto"
        autoPlay={!still}
        loop
        muted
        playsInline
        tabIndex={-1}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
      />
      <span className="silo-tweet-gif-badge" aria-hidden="true">
        GIF
      </span>
    </button>
  );
}

/**
 * An X post's photos and videos, served by silo's own `/source-media` proxy so
 * the browser never calls X. Photos open in the image viewer; videos load only
 * when played; GIFs loop silently like they do on X.
 */
export function TweetMedia({
  linkId,
  mediaUrls,
  hasPoster,
}: {
  linkId: string;
  mediaUrls: readonly string[];
  hasPoster: boolean;
}) {
  const [viewing, setViewing] = useState<number | null>(null);
  const source = (index: number | 'poster') =>
    apiUrl(`/api/links/${encodeURIComponent(linkId)}/source-media/${index}`);
  const items = mediaUrls
    .map((url, index) => ({ index, kind: mediaKind(url) }))
    .filter((item): item is Item => item.kind !== undefined)
    .slice(0, 4);
  const photos = items.filter((item) => item.kind === 'photo');
  if (items.length === 0) return null;
  return (
    <div className="silo-tweet-media" data-count={items.length}>
      {items.map((item, position) =>
        item.kind === 'photo' ? (
          <button
            key={item.index}
            type="button"
            className="silo-tweet-photo"
            aria-label={`View image ${photos.indexOf(item) + 1} of ${photos.length}`}
            onClick={() => setViewing(photos.indexOf(item))}
          >
            <img className="silo-tweet-img" src={source(item.index)} alt="" loading="lazy" />
          </button>
        ) : item.kind === 'gif' ? (
          <TweetGif key={item.index} src={source(item.index)} />
        ) : (
          <VideoPlayer
            key={item.index}
            src={source(item.index)}
            poster={position === 0 && hasPoster ? source('poster') : undefined}
            label="Video from the post"
          />
        ),
      )}
      {viewing !== null && (
        <ImageViewer
          images={photos.map((photo) => ({
            src: source(photo.index),
            alt: '',
            caption: '',
            href: source(photo.index),
          }))}
          index={viewing}
          onStep={(delta) =>
            setViewing((open) =>
              open === null ? open : (open + delta + photos.length) % photos.length,
            )
          }
          onClose={() => setViewing(null)}
        />
      )}
    </div>
  );
}
