import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NavItem } from './NavItem';

describe('NavItem', () => {
  it('renders an inactive item: ink text, background left to CSS (not inline)', () => {
    render(<NavItem label="Library" href="/" />);
    const link = screen.getByRole('link', { name: /library/i });
    expect(link.style.color).toBe('var(--ink)');
    // The inactive case must NOT set an inline `background` (review fix,
    // CodeRabbit): inline styles always beat CSS regardless of specificity,
    // so an inline `background: transparent` here would silently defeat
    // `.silo-nav-item:hover`'s `--hov` background in base.css. The resting
    // transparent + the hover/press feedback are CSS-owned via the
    // `silo-nav-item` class instead.
    expect(link.style.background).toBe('');
    expect(link.className).toContain('silo-nav-item');
    expect(link.getAttribute('aria-current')).toBeNull();
  });

  it('renders an active item: ink on a filled --surface-active box with a hairline edge, never amber', () => {
    render(<NavItem label="Library" href="/" active />);
    const link = screen.getByRole('link', { name: /library/i });
    expect(link.style.color).toBe('var(--ink)');
    // Active = ink on a filled --surface-active box (the SAME family as the
    // hover pill's --hov/--surface-hover fill, one step further) with a
    // hairline --line inset edge + a subtle elevation shadow, so the active
    // row reads as a clearly highlighted BOX matching the hover-pill look —
    // NOT `var(--bg)` (invisible in dark mode: the sidebar sits transparent
    // directly on the app's own --bg ground) and NEVER amber.
    expect(link.style.background).toBe('var(--surface-active)');
    expect(link.style.boxShadow).not.toBe('none');
    expect(link.style.boxShadow).toBe('var(--elev-1), inset 0 0 0 1px var(--line)');
    expect(link.getAttribute('aria-current')).toBe('page');
    // assert no amber token anywhere in the active row's chrome
    expect(link.style.color).not.toContain('--mark');
    expect(link.style.background).not.toContain('--mark');
    expect(link.style.boxShadow).not.toContain('--mark');
  });

  it('an inactive item sets no inline background/shadow (the raised look is active-only)', () => {
    render(<NavItem label="Trash" href="/trash" />);
    const link = screen.getByRole('link', { name: /trash/i });
    expect(link.style.background).toBe('');
    expect(link.style.boxShadow).toBe('');
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

  it('the "tag" variant is weight 500 (bumped to match the Library/Trash nav rows)', () => {
    render(<NavItem label="#ai" href="/tags/ai" variant="tag" />);
    const link = screen.getByRole('link', { name: /ai/i });
    expect(link.style.fontWeight).toBe('500');
  });

  it('the "settings" variant uses --mut (not --ink) for its inactive color', () => {
    render(<NavItem label="Settings" href="/settings" variant="settings" />);
    const link = screen.getByRole('link', { name: /settings/i });
    expect(link.style.color).toBe('var(--mut)');
    expect(link.style.fontWeight).toBe('400');
  });

  it('the default variant is weight 500 with --ink inactive color and 7px var(--s2-5) padding (K3 token migration)', () => {
    render(<NavItem label="Library" href="/" />);
    const link = screen.getByRole('link', { name: /library/i });
    expect(link.style.fontWeight).toBe('500');
    expect(link.style.color).toBe('var(--ink)');
    expect(link.style.padding).toBe('7px var(--s2-5)');
  });

  it('the "tag" variant uses 7px var(--s2-5) padding (bumped to match nav rows)', () => {
    render(<NavItem label="#ai" href="/tags/ai" variant="tag" />);
    const link = screen.getByRole('link', { name: /ai/i });
    expect(link.style.padding).toBe('7px var(--s2-5)');
  });

  it('the "tag" variant uses a slightly tighter icon-to-label gap than main nav rows', () => {
    render(
      <>
        <NavItem label="Library" href="/" icon={<span aria-hidden="true">#</span>} />
        <NavItem
          label="ai"
          href="/tags/ai"
          icon={<span aria-hidden="true">#</span>}
          variant="tag"
        />
      </>,
    );
    const library = screen.getByRole('link', { name: /library/i });
    const tag = screen.getByRole('link', { name: /ai/i });
    expect(library.style.gap).toBe('var(--s2-5)');
    expect(tag.style.gap).toBe('var(--s1-5)');
  });

  describe('button mode (no href — plan 024, the Search row)', () => {
    it('renders a <button type="button"> instead of an <a> when href is omitted', () => {
      render(<NavItem label="Search" />);
      const button = screen.getByRole('button', { name: /search/i });
      expect(button.tagName).toBe('BUTTON');
      expect(button.getAttribute('type')).toBe('button');
      expect(screen.queryByRole('link')).toBeNull();
    });

    it('fires onClick like any other button', () => {
      const onClick = vi.fn();
      render(<NavItem label="Search" onClick={onClick} />);
      fireEvent.click(screen.getByRole('button', { name: /search/i }));
      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('never sets aria-current — a button has no "current page" to mark', () => {
      render(<NavItem label="Search" active />);
      const button = screen.getByRole('button', { name: /search/i });
      expect(button.getAttribute('aria-current')).toBeNull();
    });

    it('renders byte-identical row chrome to the anchor form: same padding, font, icon slot', () => {
      render(<NavItem label="Search" icon={<svg aria-hidden="true" />} meta="/" />);
      const button = screen.getByRole('button', { name: /search/i });
      expect(button.style.padding).toBe('7px var(--s2-5)');
      expect(button.style.fontWeight).toBe('500');
      expect(button.style.fontSize).toBe('var(--text-base)');
      expect(button.style.color).toBe('var(--ink)');
      expect(button.className).toContain('silo-nav-item');
      expect(button.querySelector('svg')).not.toBeNull();
      expect(screen.getByText('/')).toBeDefined();
    });

    it('is keyboard-focusable', () => {
      render(<NavItem label="Search" />);
      const button = screen.getByRole('button', { name: /search/i });
      button.focus();
      expect(document.activeElement).toBe(button);
    });
  });

  it('anchor and button modes render identical row geometry for the same props (Search vs. Library parity)', () => {
    const icon = <svg aria-hidden="true" />;
    render(
      <>
        <NavItem label="Library" href="/" icon={icon} meta={12} />
        <NavItem label="Search" icon={icon} meta="/" />
      </>,
    );
    const link = screen.getByRole('link', { name: /library/i });
    const button = screen.getByRole('button', { name: /search/i });
    expect(button.style.padding).toBe(link.style.padding);
    expect(button.style.fontSize).toBe(link.style.fontSize);
    expect(button.style.fontWeight).toBe(link.style.fontWeight);
    expect(button.style.color).toBe(link.style.color);
  });
});
