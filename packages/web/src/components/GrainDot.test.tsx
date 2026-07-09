import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GrainDot } from './GrainDot';

describe('GrainDot', () => {
  it('renders the Stack brand mark as an accessible inline SVG', () => {
    const { container } = render(<GrainDot />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('role')).toBe('img');
    expect(svg?.getAttribute('aria-label')).toBe('silo');
    // Three bars: two ink (theme-aware), one amber-grain gradient.
    const rects = Array.from(container.querySelectorAll('rect'));
    expect(rects).toHaveLength(3);

    // The mark's identity lives in WHICH bar is amber, not just the bar count:
    // exactly the top bar carries the grain gradient; the lower two are the
    // theme-aware `--ink` token. Guards against a regression that drops the
    // gradient or paints the wrong (or a theme-flipped) bar amber.
    expect(container.querySelector('linearGradient#silo-mark-grain')).not.toBeNull();
    const grainBars = rects.filter((r) => r.getAttribute('fill') === 'url(#silo-mark-grain)');
    const inkBars = rects.filter((r) => r.getAttribute('fill') === 'var(--ink)');
    expect(grainBars).toHaveLength(1);
    expect(inkBars).toHaveLength(2);
  });

  it('renders the plated lockup with a squircle plate and all three bars on it', () => {
    const { container } = render(<GrainDot size={26} plate />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('aria-label')).toBe('silo');

    // Plate + three bars = 4 rects. The plate uses the brand-fixed plate
    // token; the two lower bars sit on the plate via `--mark-plate-ink` (NOT
    // `--ink`), so they keep full contrast regardless of app theme; the top
    // bar is still the amber grain. This is what fixes the low-contrast bar
    // that washed out against the sidebar ground.
    const rects = Array.from(container.querySelectorAll('rect'));
    expect(rects).toHaveLength(4);
    expect(rects.filter((r) => r.getAttribute('fill') === 'var(--mark-plate)')).toHaveLength(1);
    expect(rects.filter((r) => r.getAttribute('fill') === 'var(--mark-plate-ink)')).toHaveLength(2);
    expect(rects.filter((r) => r.getAttribute('fill') === 'url(#silo-mark-grain)')).toHaveLength(1);
  });

  it('defaults to 15px and accepts a size override', () => {
    const { container: defaultContainer } = render(<GrainDot />);
    const defaultSvg = defaultContainer.querySelector('svg');
    expect(defaultSvg?.getAttribute('width')).toBe('15');
    expect(defaultSvg?.getAttribute('height')).toBe('15');

    const { container } = render(<GrainDot size={22} />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe('22');
    expect(svg?.getAttribute('height')).toBe('22');
  });
});
