import { lazy, Suspense } from 'react';
import type { StickerName } from './EmptySticker';

// The sticker code (canvas runtime, motions, six drawings) stays out of the main chunk.
const EmptySticker = lazy(() =>
  import('./EmptySticker').then((module) => ({ default: module.EmptySticker })),
);

/**
 * Where an empty state's sticker goes. Holds a same-size box while the sticker
 * code loads, so the headline below never jumps.
 */
export function StickerSlot({ name, size = 120 }: { name: StickerName; size?: number }) {
  return (
    <Suspense
      fallback={<span aria-hidden="true" style={{ display: 'block', width: size, height: size }} />}
    >
      <EmptySticker name={name} size={size} />
    </Suspense>
  );
}
