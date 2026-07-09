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
