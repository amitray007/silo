import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GrainDot } from './GrainDot';

describe('GrainDot', () => {
  it('renders the brand grain-dot class (gradient defined once, in base.css)', () => {
    const { container } = render(<GrainDot />);
    const dot = container.querySelector('.silo-grain-dot');
    expect(dot).not.toBeNull();
  });

  it('defaults to 15px and accepts a size override', () => {
    const { container } = render(<GrainDot size={22} />);
    const dot = container.querySelector('.silo-grain-dot') as HTMLElement;
    expect(dot.style.width).toBe('22px');
    expect(dot.style.height).toBe('22px');
  });
});
