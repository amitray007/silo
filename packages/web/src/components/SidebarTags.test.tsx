import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
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

it('focuses find only when opened by its button and explains an unmatched filter', () => {
  renderSidebarTags(
    <SidebarTags tags={[{ name: 'design', count: 1 }]} renderTagLink={renderTagLink} />,
  );
  const find = screen.getByRole('button', { name: 'Find a tag' });
  fireEvent.click(find);
  const input = screen.getByRole('textbox', { name: 'Find tag' });
  expect(document.activeElement).toBe(input);
  fireEvent.change(input, { target: { value: 'missing' } });
  expect(screen.getByText('No tags match "').closest('p')?.textContent).toBe(
    'No tags match "missing"',
  );
  expect(screen.queryByRole('link', { name: '#design' })).toBeNull();
  const toggle = screen.getByRole('button', { name: 'Tags' });
  toggle.focus();
  fireEvent.click(toggle);
  expect(screen.queryByRole('textbox', { name: 'Find tag' })).toBeNull();
  fireEvent.click(toggle);
  expect(document.activeElement).toBe(toggle);
  expect(screen.getByRole('textbox', { name: 'Find tag' })).toHaveProperty('value', 'missing');
  fireEvent.click(find);
  expect(screen.queryByText('No tags match "')).toBeNull();
  expect(screen.getByRole('link', { name: '#design' })).toBeDefined();
  fireEvent.click(find);
  expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Find tag' }));
  expect(screen.getByRole('textbox', { name: 'Find tag' })).toHaveProperty('value', '');
});

it('clears by button or Escape, then closes on empty Escape and restores toggle focus', () => {
  renderSidebarTags(
    <SidebarTags tags={[{ name: 'design', count: 1 }]} renderTagLink={renderTagLink} />,
  );
  const find = screen.getByRole('button', { name: 'Find a tag' });
  fireEvent.click(find);
  const input = screen.getByRole('textbox', { name: 'Find tag' });
  expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull();
  fireEvent.change(input, { target: { value: 'Design' } });
  const clear = screen.getByRole('button', { name: 'Clear' });
  clear.focus();
  fireEvent.click(clear);
  expect(input).toHaveProperty('value', '');
  expect(document.activeElement).toBe(input);
  expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull();
  fireEvent.change(input, { target: { value: 'missing' } });
  expect(screen.getByText('No tags match "')).toBeDefined();
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(input).toHaveProperty('value', '');
  expect(document.activeElement).toBe(input);
  expect(screen.queryByText('No tags match "')).toBeNull();
  expect(screen.getByRole('link', { name: '#design' })).toBeDefined();
  expect(find.getAttribute('aria-expanded')).toBe('true');
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(screen.queryByRole('textbox', { name: 'Find tag' })).toBeNull();
  expect(document.activeElement).toBe(find);
  expect(find.getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(find);
  const emptyInput = screen.getByRole('textbox', { name: 'Find tag' });
  expect(document.activeElement).toBe(emptyInput);
  fireEvent.keyDown(emptyInput, { key: 'Escape' });
  expect(screen.queryByRole('textbox', { name: 'Find tag' })).toBeNull();
  expect(document.activeElement).toBe(find);
});

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
