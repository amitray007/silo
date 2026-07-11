import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Skeleton } from './Skeleton';

describe('Skeleton', () => {
  it('renders at the given height, default full width, and default radius', () => {
    const { container } = render(<Skeleton height={34} />);
    const block = container.firstChild as HTMLElement;
    expect(block.style.height).toBe('34px');
    expect(block.style.width).toBe('100%');
    expect(block.style.borderRadius).toBe('8px');
  });

  it('accepts explicit width (number → px) and radius', () => {
    const { container } = render(<Skeleton width={120} height={12} radius={4} />);
    const block = container.firstChild as HTMLElement;
    expect(block.style.width).toBe('120px');
    expect(block.style.borderRadius).toBe('4px');
  });

  it('accepts a CSS-length width string verbatim', () => {
    const { container } = render(<Skeleton width="60%" height={12} />);
    expect((container.firstChild as HTMLElement).style.width).toBe('60%');
  });

  it('is aria-hidden — the loading semantics live on the container, not each block', () => {
    const { container } = render(<Skeleton height={20} />);
    expect((container.firstChild as HTMLElement).getAttribute('aria-hidden')).toBe('true');
  });

  it('runs the siloShimmer animation (stilled by prefers-reduced-motion via the global rule)', () => {
    const { container } = render(<Skeleton height={20} />);
    expect((container.firstChild as HTMLElement).style.animation).toContain('siloShimmer');
  });

  it('merges a caller-supplied style (e.g. marginBottom for stacked rows)', () => {
    const { container } = render(<Skeleton height={20} style={{ marginBottom: 8 }} />);
    expect((container.firstChild as HTMLElement).style.marginBottom).toBe('8px');
  });
});
