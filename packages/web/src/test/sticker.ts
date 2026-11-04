import { screen, waitFor } from '@testing-library/react';
import { expect } from 'vitest';

/**
 * Asserts an empty state's sticker (components/stickers) shows above its
 * headline: the lazy chunk has loaded, the wrapper is hidden from assistive
 * tech, and its canvas carries the icon's name.
 */
export async function expectStickerAbove(name: string, headline: string) {
  const sticker = await waitFor(() => {
    const el = document.querySelector<HTMLElement>(`[data-sticker="${name}"]`);
    expect(el).not.toBeNull();
    expect(el?.querySelector('canvas')).not.toBeNull();
    return el as HTMLElement;
  });
  expect(sticker.getAttribute('aria-hidden')).toBe('true');
  expect(sticker.querySelector('canvas')?.getAttribute('aria-label')).toBe(name);
  expect(screen.queryByRole('img', { name })).toBeNull();
  const title = screen.getByText(headline);
  // The headline follows the sticker, or wraps it when both share one text block (the palette).
  const follows = Node.DOCUMENT_POSITION_FOLLOWING | Node.DOCUMENT_POSITION_CONTAINS;
  expect(sticker.compareDocumentPosition(title) & follows).toBeTruthy();
}
