import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StickerSlot } from './StickerSlot';

describe('StickerSlot', () => {
  it('holds a same-size box while the sticker code loads, then shows the canvas', async () => {
    const { container } = render(<StickerSlot name="folder" />);
    const holder = container.firstElementChild as HTMLElement;
    expect(holder.style.width).toBe('120px');
    expect(holder.style.height).toBe('120px');
    expect(holder.getAttribute('aria-hidden')).toBe('true');

    const sticker = await screen.findByLabelText('folder', { selector: 'canvas' });
    expect(sticker.tagName).toBe('CANVAS');
    const wrapper = container.querySelector<HTMLElement>('[data-sticker="folder"]');
    expect(wrapper?.getAttribute('aria-hidden')).toBe('true');
    expect(wrapper?.style.width).toBe('120px');
  });

  it('takes a custom size and stays out of the accessibility tree', async () => {
    const { container } = render(<StickerSlot name="search" size={72} />);
    await screen.findByLabelText('search', { selector: 'canvas' });
    expect(screen.queryByRole('img')).toBeNull();
    expect(container.querySelector<HTMLElement>('[data-sticker="search"]')?.style.width).toBe(
      '72px',
    );
  });
});
