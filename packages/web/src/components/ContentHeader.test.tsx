import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ContentHeader } from './ContentHeader';

describe('ContentHeader', () => {
  it('renders the title and count', () => {
    render(<ContentHeader title="Library" count={128} />);
    expect(screen.getByText('Library')).toBeDefined();
    expect(screen.getByText('128')).toBeDefined();
  });

  it('renders without a count when omitted', () => {
    render(<ContentHeader title="Settings" />);
    expect(screen.getByText('Settings')).toBeDefined();
  });

  it('renders the children slot in place of the default placeholder', () => {
    render(
      <ContentHeader title="Library">
        <button type="button">omnibar</button>
      </ContentHeader>,
    );
    expect(screen.getByRole('button', { name: /omnibar/i })).toBeDefined();
  });

  it('renders an empty right-aligned placeholder when no children are given (reserves the omnibar slot)', () => {
    const { container } = render(<ContentHeader title="Library" />);
    const placeholder = container.querySelector('[aria-hidden="true"]');
    expect(placeholder).not.toBeNull();
  });
});
