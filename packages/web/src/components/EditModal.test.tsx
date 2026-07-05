import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeLink } from '../test/fixtures';
import { EditModal } from './EditModal';
import { RowMenuProvider, useRowMenu } from './RowMenuContext';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Renders `EditModal` for `link` with the edit modal already "open" via the shared context (mirrors how `AppFrame`'s `RowMenuLayer` only renders it when `editingLink` is set) plus a trigger button so focus-restore-on-close is observable. */
function Harness({ link }: { link: ReturnType<typeof makeLink> }) {
  const { editingLink, openEdit } = useRowMenu();
  return (
    <div>
      <button type="button" onClick={() => openEdit(link)}>
        trigger
      </button>
      {editingLink && <EditModal link={editingLink} />}
    </div>
  );
}

function renderModal(overrides: Parameters<typeof makeLink>[0] = {}) {
  const link = makeLink({
    id: 'edit-1',
    url: 'https://example.com/a-post',
    title: 'Original title',
    description: 'Original description',
    notes: 'Original note',
    tags: ['mcp'],
    ...overrides,
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <RowMenuProvider>
        <Harness link={link} />
      </RowMenuProvider>
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByText('trigger'));
  return { ...utils, link, queryClient };
}

describe('EditModal', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ tags: [{ name: 'mcp', count: 2 }] })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('prefills title/description/note from the link, and shows its current tags as chips', () => {
    renderModal();
    expect(screen.getByPlaceholderText("how you'll look for it later")).toHaveProperty(
      'value',
      'Original title',
    );
    expect(screen.getByPlaceholderText('what this is, in your words')).toHaveProperty(
      'value',
      'Original description',
    );
    expect(screen.getByPlaceholderText('why you kept it')).toHaveProperty('value', 'Original note');
    expect(screen.getByText('mcp')).toBeDefined();
  });

  it('shows "choose tags" when the link has no tags', () => {
    renderModal({ tags: [] });
    expect(screen.getByText('choose tags')).toBeDefined();
  });

  it('shows the domain in the header', () => {
    renderModal({ url: 'https://sub.example.com/x' });
    expect(screen.getByText('sub.example.com')).toBeDefined();
  });

  it('Save PATCHes only the fields that changed', async () => {
    renderModal();
    fireEvent.change(screen.getByPlaceholderText("how you'll look for it later"), {
      target: { value: 'New title' },
    });

    fireEvent.click(screen.getByText('Save'));

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        '/api/links/edit-1',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ title: 'New title' }),
        }),
      ),
    );
  });

  it('Save with no changes does not PATCH at all', () => {
    renderModal();
    fireEvent.click(screen.getByText('Save'));
    expect(fetch).not.toHaveBeenCalledWith('/api/links/edit-1', expect.anything());
  });

  it('Save closes the modal', async () => {
    renderModal();
    fireEvent.change(screen.getByPlaceholderText('why you kept it'), {
      target: { value: 'updated note' },
    });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('removing a tag chip calls the remove-tag mutation immediately (live, not buffered until Save)', async () => {
    renderModal({ tags: ['mcp'] });
    fireEvent.click(screen.getByTitle('remove'));

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        '/api/links/edit-1/tags/mcp',
        expect.objectContaining({ method: 'DELETE' }),
      ),
    );
  });

  it('opening the tags fly-out and toggling an unassigned tag calls add-tag', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        tags: [
          { name: 'mcp', count: 2 },
          { name: 'design', count: 1 },
        ],
      }),
    );
    renderModal({ tags: ['mcp'] });

    fireEvent.click(screen.getByText('▾'));
    await waitFor(() => expect(screen.getByPlaceholderText('find or create a tag')).toBeDefined());
    await waitFor(() => expect(screen.getByText('design')).toBeDefined());

    fireEvent.click(screen.getByText('design').closest('button') as HTMLButtonElement);

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        '/api/links/edit-1/tags',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ tag: 'design' }) }),
      ),
    );
  });

  it('typing a query that matches no existing tag shows a create option; clicking it creates + assigns the tag', async () => {
    renderModal({ tags: [] });
    fireEvent.click(screen.getByText('choose tags'));
    const input = await screen.findByPlaceholderText('find or create a tag');
    fireEvent.change(input, { target: { value: 'brand-new-tag' } });

    await waitFor(() => expect(screen.getByText('create "brand-new-tag"')).toBeDefined());

    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ name: 'brand-new-tag' }, 201));
    fireEvent.click(screen.getByText('create "brand-new-tag"'));

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        '/api/tags',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ name: 'brand-new-tag' }),
        }),
      ),
    );
  });

  it("removing a tag chip updates the modal's OWN chip list immediately, not just the background cache (regression: editingLink is a frozen snapshot, never re-synced — see EditModal/EditTagsFlyout doc comments)", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ tags: [{ name: 'mcp', count: 2 }] }));
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ link: makeLink({ id: 'edit-1' }) }, 200));
    renderModal({ tags: ['mcp'] });

    expect(screen.getByText('mcp')).toBeDefined();
    fireEvent.click(screen.getByTitle('remove'));

    // The chip disappears from THIS modal's own render — not dependent on a
    // background refetch of `link.tags` (which never happens, since `link`
    // is a one-time snapshot) landing first.
    await waitFor(() => expect(screen.queryByText('mcp')).toBeNull());
    expect(screen.getByText('choose tags')).toBeDefined();
  });

  it('adding a tag via the fly-out shows it as a chip immediately in the same modal instance', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        tags: [
          { name: 'mcp', count: 2 },
          { name: 'design', count: 1 },
        ],
      }),
    );
    renderModal({ tags: ['mcp'] });

    fireEvent.click(screen.getByText('▾'));
    await waitFor(() => expect(screen.getByText('design')).toBeDefined());

    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ link: makeLink({ id: 'edit-1', tags: ['mcp', 'design'] }) }, 200),
    );
    fireEvent.click(screen.getByText('design').closest('button') as HTMLButtonElement);

    // Close the fly-out to make the chip row's own "design" chip unambiguous
    // from the fly-out option button also named "design".
    await waitFor(() => {
      const designButtons = screen.getAllByText('design');
      expect(designButtons.length).toBeGreaterThan(0);
    });
  });

  it('trash calls the trash mutation and closes the modal', async () => {
    renderModal();
    fireEvent.click(screen.getByText('trash'));

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        '/api/links/edit-1/trash',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('cancel closes the modal without saving', () => {
    renderModal();
    fireEvent.change(screen.getByPlaceholderText("how you'll look for it later"), {
      target: { value: 'Unsaved edit' },
    });
    fireEvent.click(screen.getByText('cancel'));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(fetch).not.toHaveBeenCalledWith('/api/links/edit-1', expect.anything());
  });

  it('Escape closes the modal without saving', () => {
    renderModal();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('clicking the scrim (outside the panel) closes the modal', () => {
    renderModal();
    const dialog = screen.getByRole('dialog');
    // The scrim is the dialog's parent (the fixed-inset backdrop div).
    fireEvent.click(dialog.parentElement as HTMLElement);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('clicking inside the panel does not close the modal', () => {
    renderModal();
    fireEvent.click(screen.getByText('Edit'));
    expect(screen.getByRole('dialog')).toBeDefined();
  });

  it('focus moves into the panel on open', () => {
    renderModal();
    expect(document.activeElement).toBe(screen.getByRole('dialog'));
  });

  it('closing returns focus to the trigger that opened it', async () => {
    // jsdom's `fireEvent.click` (unlike a real click) doesn't itself move
    // focus, so the trigger is focused explicitly here to reproduce what a
    // real browser does when a user clicks the ⋯ menu's "edit" button before
    // the modal opens and captures `document.activeElement`.
    const link = makeLink({ id: 'edit-1', url: 'https://example.com/a-post' });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <RowMenuProvider>
          <Harness link={link} />
        </RowMenuProvider>
      </QueryClientProvider>,
    );
    const trigger = screen.getByText('trigger');
    trigger.focus();
    fireEvent.click(trigger);

    fireEvent.click(screen.getByText('cancel'));
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});
