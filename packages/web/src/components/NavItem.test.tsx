import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { NavItem } from './NavItem';

describe('NavItem', () => {
  it('renders an inactive item: mut text on transparent bg', () => {
    render(<NavItem label="Library" href="/" />);
    const link = screen.getByRole('link', { name: /library/i });
    expect(link.style.color).toBe('var(--mut)');
    expect(link.style.background).toBe('transparent');
    expect(link.getAttribute('aria-current')).toBeNull();
  });

  it('renders an active item: ink text on --hov, never amber', () => {
    render(<NavItem label="Library" href="/" active />);
    const link = screen.getByRole('link', { name: /library/i });
    expect(link.style.color).toBe('var(--ink)');
    expect(link.style.background).toBe('var(--hov)');
    expect(link.getAttribute('aria-current')).toBe('page');
    // assert no amber token anywhere in the active row's chrome
    expect(link.style.color).not.toContain('--mark');
    expect(link.style.background).not.toContain('--mark');
  });

  it('renders a right-aligned ghost count/meta', () => {
    render(<NavItem label="Library" href="/" meta={12} />);
    expect(screen.getByText('12')).toBeDefined();
  });

  it('is keyboard-focusable', () => {
    render(<NavItem label="Trash" href="/trash" />);
    const link = screen.getByRole('link', { name: /trash/i });
    link.focus();
    expect(document.activeElement).toBe(link);
  });
});
