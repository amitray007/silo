import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ComingSoon } from './ComingSoon';

describe('ComingSoon', () => {
  it('renders the title', () => {
    render(<ComingSoon title="Nothing kept yet." />);
    expect(screen.getByText('Nothing kept yet.')).toBeDefined();
  });

  it('renders an optional subtitle', () => {
    render(<ComingSoon title="Trash" subtitle="Coming soon." />);
    expect(screen.getByText('Coming soon.')).toBeDefined();
  });

  it('omits the subtitle element when not provided', () => {
    const { container } = render(<ComingSoon title="Settings" />);
    expect(container.querySelectorAll('p')).toHaveLength(1);
  });
});
