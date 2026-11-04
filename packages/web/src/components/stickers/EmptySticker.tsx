import { mono } from './fun';
import { chat, folder, mailbox, search, tag, trash } from './icons';
import { Sticker } from './Sticker';

const ICONS = { folder, tag, trash, mailbox, chat, search } as const;

export type StickerName = keyof typeof ICONS;

/** The Silo accent (`--mark` in tokens.css). A canvas cannot read a CSS variable, so it is repeated here. */
const ACCENT = mono('#f26b1d');

/**
 * One animated isometric sticker for an empty state: plays once when it first
 * shows, rests on the icon's still frame, replays on hover. Reduced motion
 * shows the still frame only. Decorative, so hidden from assistive tech; the
 * headline beside it carries the meaning. Loaded lazily by `StickerSlot`.
 */
export function EmptySticker({ name, size }: { name: StickerName; size: number }) {
  return (
    <span
      aria-hidden="true"
      data-sticker={name}
      style={{ display: 'block', width: size, height: size }}
    >
      <Sticker icon={ICONS[name]} palette={ACCENT} loop={false} replayOnHover />
    </span>
  );
}
