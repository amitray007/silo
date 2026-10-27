import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BrandMark } from './BrandMark';

describe('BrandMark', () => {
  it('renders the accessible orange tile with three decorative bars', () => {
    render(<BrandMark />);
    const mark = screen.getByRole('img', { name: 'silo' });
    expect(mark.className).toBe('silo-brand-mark');
    expect(mark.style.width).toBe('26px');
    expect(mark.style.height).toBe('26px');
    const bars = mark.querySelectorAll('i');
    expect(bars).toHaveLength(3);
    for (const bar of bars) expect(bar.getAttribute('aria-hidden')).toBe('true');
  });

  it('scales the tile without changing its accessible name', () => {
    render(<BrandMark size={44} />);
    const mark = screen.getByRole('img', { name: 'silo' });
    expect(mark.style.width).toBe('44px');
    expect(mark.style.height).toBe('44px');
  });
});
