import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import type { TagCount } from '../api/types';
import { SidebarTags } from './SidebarTags';

/** Minimal `renderTagLink` stub — a real `<a>` so "real tag links" queries can assert on it. */
function renderTagLink(tag: TagCount) {
  return (
    <a key={tag.name} href={`/tags/${tag.name}`}>
      #{tag.name}
    </a>
  );
}

/** `SidebarTags` calls `useCreateTag()` (the "+ new tag" flow) unconditionally, so every render needs a `QueryClientProvider` even for tests that never touch that flow — mirrors `Sidebar.test.tsx`'s own `renderSidebar` wrapper. */
function renderSidebarTags(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe('SidebarTags loading skeleton', () => {
  it('loading + no tags yet: renders skeleton rows, keeps the "Tags" header, and shows no real tag links', () => {
    const { container } = renderSidebarTags(
      <SidebarTags tags={[]} loading renderTagLink={renderTagLink} />,
    );

    expect(screen.getByText('Tags')).toBeDefined();
    expect(screen.getByLabelText('Find a tag')).toBeDefined();
    expect(screen.queryAllByRole('link')).toHaveLength(0);

    const scrollRegion = container.querySelector('.silo-tag-scroll');
    expect(scrollRegion).not.toBeNull();
    const skeletonBlocks = scrollRegion?.querySelectorAll('[aria-hidden="true"]') ?? [];
    expect(skeletonBlocks.length).toBeGreaterThan(0);
  });

  it('loading false + tags present: renders the real tag links, no skeleton blocks', () => {
    const tags: TagCount[] = [
      { name: 'ai', count: 3 },
      { name: 'design', count: 1 },
    ];
    const { container } = renderSidebarTags(
      <SidebarTags tags={tags} loading={false} renderTagLink={renderTagLink} />,
    );

    const scrollRegion = container.querySelector('.silo-tag-scroll');
    expect(scrollRegion?.querySelectorAll('[aria-hidden="true"]')).toHaveLength(0);
    expect(screen.getByRole('link', { name: '#ai' })).toBeDefined();
    expect(screen.getByRole('link', { name: '#design' })).toBeDefined();
  });

  it('defaults loading to false — an unspecified loading prop behaves like the pre-existing contract', () => {
    const tags: TagCount[] = [{ name: 'ai', count: 3 }];
    renderSidebarTags(<SidebarTags tags={tags} renderTagLink={renderTagLink} />);
    expect(screen.getByRole('link', { name: '#ai' })).toBeDefined();
  });

  it('loading true but tags already resolved: renders the real tags, not skeletons (data present wins)', () => {
    const tags: TagCount[] = [{ name: 'ai', count: 3 }];
    const { container } = renderSidebarTags(
      <SidebarTags tags={tags} loading renderTagLink={renderTagLink} />,
    );

    const scrollRegion = container.querySelector('.silo-tag-scroll');
    expect(scrollRegion?.querySelectorAll('[aria-hidden="true"]')).toHaveLength(0);
    expect(screen.getByRole('link', { name: '#ai' })).toBeDefined();
  });
});

describe('SidebarTags empty state (unchanged)', () => {
  it('loading false + zero tags: renders neither skeletons nor tag links, just the header/tools', () => {
    const { container } = renderSidebarTags(
      <SidebarTags tags={[]} loading={false} renderTagLink={renderTagLink} />,
    );

    expect(screen.getByText('Tags')).toBeDefined();
    const scrollRegion = container.querySelector('.silo-tag-scroll');
    expect(scrollRegion?.querySelectorAll('[aria-hidden="true"]')).toHaveLength(0);
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });
});
