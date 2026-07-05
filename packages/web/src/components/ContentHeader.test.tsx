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

  it('renders no ◌ capturing chrome anywhere (removed per user feedback — no capturing UI)', () => {
    render(<ContentHeader title="Library" />);
    expect(screen.queryByText('◌')).toBeNull();
    expect(screen.queryByText(/capturing/)).toBeNull();
  });

  it('shows a calm capture-error message when captureError is set (plan 011, V3-3)', () => {
    render(<ContentHeader title="Library" captureError="Not a valid http(s) URL" />);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain("couldn't save that");
    expect(alert.textContent).toContain('Not a valid http(s) URL');
  });

  it('renders no capture-error chrome when captureError is omitted', () => {
    render(<ContentHeader title="Library" />);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
