import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SidebarSection } from './SidebarSection';

describe('SidebarSection', () => {
  it('renders the heading label and children', () => {
    render(
      <SidebarSection label="Tags">
        <div>child content</div>
      </SidebarSection>,
    );
    expect(screen.getByText('Tags')).toBeDefined();
    expect(screen.getByText('child content')).toBeDefined();
  });

  it('styles the heading as ghost, small, non-amber', () => {
    render(
      <SidebarSection label="Tags">
        <div />
      </SidebarSection>,
    );
    const heading = screen.getByText('Tags');
    expect(heading.style.color).toBe('var(--ghost)');
  });
});
