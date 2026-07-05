import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { makeLink as link } from '../test/fixtures';
import { DayGroup } from './DayGroup';

describe('DayGroup', () => {
  it('renders the label in the Oat style', () => {
    render(<DayGroup label="Today" links={[]} />);
    const label = screen.getByText('Today');
    expect(label.style.fontSize).toBe('0.78rem');
    expect(label.style.fontWeight).toBe('500');
    expect(label.style.color).toBe('var(--ghost)');
  });

  it('renders one LinkRow per link, in order', () => {
    const links = [link({ id: 'a', title: 'First' }), link({ id: 'b', title: 'Second' })];
    render(<DayGroup label="Today" links={links} />);
    const titles = screen.getAllByRole('link').map((a) => a.textContent);
    expect(titles[0]).toContain('First');
    expect(titles[1]).toContain('Second');
  });

  it('renders just the label when there are no links', () => {
    render(<DayGroup label="Earlier" links={[]} />);
    expect(screen.getByText('Earlier')).toBeDefined();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });
});
