import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Omnibar } from './Omnibar';

describe('Omnibar (non-interactive box, later user-feedback pass)', () => {
  it('shows the "Paste a link to keep" hint text', () => {
    render(<Omnibar />);
    expect(screen.getByText('Paste a link to keep')).toBeDefined();
  });

  it('renders as a plain, non-interactive <div> — no input, no button role', () => {
    render(<Omnibar />);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('searchbox')).toBeNull();
  });

  it('renders no focusable/editable element inside it', () => {
    const { container } = render(<Omnibar />);
    expect(container.querySelector('input')).toBeNull();
    expect(container.querySelector('button')).toBeNull();
    expect(container.querySelector('[contenteditable]')).toBeNull();
  });
});
