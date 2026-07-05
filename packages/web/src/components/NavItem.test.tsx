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

  it('renders an active item: ink on the raised --bg ground + shadow, never amber', () => {
    render(<NavItem label="Library" href="/" active />);
    const link = screen.getByRole('link', { name: /library/i });
    expect(link.style.color).toBe('var(--ink)');
    // Active = ink on the lighter --bg ground (raised off the --bg2 sidebar) with
    // a subtle warm shadow — the prototype's `on` state, so the active pill reads
    // clearly. NOT --hov (barely differs from the sidebar) and NEVER amber.
    expect(link.style.background).toBe('var(--bg)');
    expect(link.style.boxShadow).not.toBe('none');
    expect(link.style.boxShadow).toContain('rgba');
    expect(link.getAttribute('aria-current')).toBe('page');
    // assert no amber token anywhere in the active row's chrome
    expect(link.style.color).not.toContain('--mark');
    expect(link.style.background).not.toContain('--mark');
    expect(link.style.boxShadow).not.toContain('--mark');
  });

  it('an inactive item has no raised background or shadow', () => {
    render(<NavItem label="Trash" href="/trash" />);
    const link = screen.getByRole('link', { name: /trash/i });
    expect(link.style.background).toBe('transparent');
    expect(link.style.boxShadow).toBe('none');
    expect(link.getAttribute('aria-current')).toBeNull();
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

  it('renders a leading icon when provided (v3: Library/Trash/Settings)', () => {
    const { container } = render(
      <NavItem
        label="Library"
        href="/"
        icon={
          <svg role="img" aria-label="bookmark">
            <title>bookmark</title>
          </svg>
        }
      />,
    );
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('renders no icon slot when none is provided (v3: tag rows)', () => {
    const { container } = render(<NavItem label="#ai" href="/tags/ai" />);
    expect(container.querySelector('svg')).toBeNull();
  });

  it('the "tag" variant is weight 400 (v3: Library/Trash default to weight 500)', () => {
    render(<NavItem label="#ai" href="/tags/ai" variant="tag" />);
    const link = screen.getByRole('link', { name: /ai/i });
    expect(link.style.fontWeight).toBe('400');
  });

  it('the "settings" variant uses --fnt (not --mut) for its inactive color', () => {
    render(<NavItem label="Settings" href="/settings" variant="settings" />);
    const link = screen.getByRole('link', { name: /settings/i });
    expect(link.style.color).toBe('var(--fnt)');
    expect(link.style.fontWeight).toBe('400');
  });

  it('the default variant is weight 500 with --mut inactive color and 7px 10px padding', () => {
    render(<NavItem label="Library" href="/" />);
    const link = screen.getByRole('link', { name: /library/i });
    expect(link.style.fontWeight).toBe('500');
    expect(link.style.color).toBe('var(--mut)');
    expect(link.style.padding).toBe('7px 10px');
  });

  it('the "tag" variant uses 5px 10px padding (v3)', () => {
    render(<NavItem label="#ai" href="/tags/ai" variant="tag" />);
    const link = screen.getByRole('link', { name: /ai/i });
    expect(link.style.padding).toBe('5px 10px');
  });
});
