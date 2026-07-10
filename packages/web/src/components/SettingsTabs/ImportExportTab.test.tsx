import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setApiBaseUrl } from '../../api/client';
import { exportUrl, ImportExportTab } from './ImportExportTab';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Builds a `File` whose `.text()` resolves to `contents` — jsdom's `File` implements `Blob.text()`, so a real `File` works directly without extra stubbing. */
function jsonFile(contents: string, name = 'export.json'): File {
  return new File([contents], name, { type: 'application/json' });
}

/** Simulates picking `file` via the hidden `<input type="file">` — jsdom `HTMLInputElement.files` is read-only, so it's set through `Object.defineProperty` (mirrors the standard RTL workaround for file inputs), then a `change` event is fired to trigger the component's `onChange` handler. */
function selectFile(input: HTMLInputElement, file: File) {
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  fireEvent.change(input);
}

function getImportFileInput(): HTMLInputElement {
  // The hidden file input has no accessible role; select it via its `type`.
  return document.querySelector('input[type="file"]') as HTMLInputElement;
}

describe('exportUrl', () => {
  it('builds /api/export?format=<format> for each format, resolved against the configured base URL', () => {
    setApiBaseUrl('http://localhost:8787');
    expect(exportUrl('json')).toBe('http://localhost:8787/api/export?format=json');
    expect(exportUrl('yaml')).toBe('http://localhost:8787/api/export?format=yaml');
    expect(exportUrl('csv')).toBe('http://localhost:8787/api/export?format=csv');
  });
});

describe('ImportExportTab (plan 027 — live Export control)', () => {
  beforeEach(() => {
    setApiBaseUrl('');
  });

  afterEach(() => {
    setApiBaseUrl('');
  });

  it('renders the Export row with a live (non-disabled) Download button', () => {
    render(<ImportExportTab />);

    const downloadButton = screen.getByRole('button', { name: 'Download' });
    expect(downloadButton).not.toHaveProperty('disabled', true);
  });

  it('renders a live (non-disabled) Import "Choose file…" button', () => {
    render(<ImportExportTab />);

    const chooseFileButton = screen.getByRole('button', { name: /Choose file/i });
    expect(chooseFileButton).not.toHaveProperty('disabled', true);
  });

  it('the format dropdown defaults to JSON and lists all three formats', () => {
    render(<ImportExportTab />);

    const trigger = screen.getByRole('button', { name: 'Export format' });
    expect(trigger.textContent).toContain('JSON');

    fireEvent.click(trigger);
    const listbox = screen.getByRole('listbox');
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(3);
    expect(listbox.textContent).toContain('JSON');
    expect(listbox.textContent).toContain('YAML');
    expect(listbox.textContent).toContain('CSV');
  });

  it('selecting a format updates the dropdown trigger label', () => {
    render(<ImportExportTab />);

    fireEvent.click(screen.getByRole('button', { name: 'Export format' }));
    fireEvent.click(screen.getByRole('option', { name: 'YAML' }));

    const trigger = screen.getByRole('button', { name: 'Export format' });
    expect(trigger.textContent).toContain('YAML');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('closes the dropdown on Escape without changing the selection', () => {
    render(<ImportExportTab />);

    const trigger = screen.getByRole('button', { name: 'Export format' });
    fireEvent.click(trigger);
    expect(screen.getByRole('listbox')).toBeDefined();

    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(trigger.textContent).toContain('JSON');
  });

  it('closes the dropdown on outside pointerdown', () => {
    render(
      <div>
        <ImportExportTab />
        <button type="button">outside</button>
      </div>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Export format' }));
    expect(screen.getByRole('listbox')).toBeDefined();

    fireEvent.pointerDown(screen.getByRole('button', { name: 'outside' }));
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});

describe('ImportExportTab (plan 028 — live Import control)', () => {
  beforeEach(() => {
    setApiBaseUrl('');
  });

  afterEach(() => {
    setApiBaseUrl('');
    vi.unstubAllGlobals();
  });

  it('selecting a valid JSON file POSTs the parsed body to /api/import', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ version: 1, total: 1, created: 1, merged: 0, skipped: [] }),
      );
    vi.stubGlobal('fetch', fetchMock);
    render(<ImportExportTab />);

    const payload = { version: 1, links: [{ url: 'https://example.com', sourceKind: 'link' }] };
    selectFile(getImportFileInput(), jsonFile(JSON.stringify(payload)));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/import');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual(payload);
  });

  it('a 200 response renders the import summary', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ version: 1, total: 3, created: 2, merged: 1, skipped: [] }),
      );
    vi.stubGlobal('fetch', fetchMock);
    render(<ImportExportTab />);

    selectFile(getImportFileInput(), jsonFile(JSON.stringify({ version: 1, links: [] })));

    expect(await screen.findByText('Imported 3 — 2 new, 1 merged')).toBeDefined();
  });

  it('a 200 response with skipped rows shows the skipped count and reasons', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        version: 1,
        total: 2,
        created: 1,
        merged: 0,
        skipped: [{ index: 1, url: 'https://bad.example', reason: 'missing url' }],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(<ImportExportTab />);

    selectFile(getImportFileInput(), jsonFile(JSON.stringify({ version: 1, links: [] })));

    const summary = await screen.findByText(/1 skipped/i);
    expect(summary).toBeDefined();
    expect(screen.getByText(/missing url/i)).toBeDefined();
  });

  it('a 401 response renders the auth-gate message', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: 'unauthorized', message: 'Unauthorized' }, 401));
    vi.stubGlobal('fetch', fetchMock);
    render(<ImportExportTab />);

    selectFile(getImportFileInput(), jsonFile(JSON.stringify({ version: 1, links: [] })));

    expect(await screen.findByText(/Import needs a server token/i)).toBeDefined();
  });

  it('a 400 response renders the server error message', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(
          { error: 'validation_error', message: "That file isn't a valid silo export." },
          400,
        ),
      );
    vi.stubGlobal('fetch', fetchMock);
    render(<ImportExportTab />);

    selectFile(getImportFileInput(), jsonFile(JSON.stringify({ version: 1, links: [] })));

    expect(await screen.findByText(/That file isn't a valid silo export\./i)).toBeDefined();
  });

  it('an invalid JSON file shows a parse error and does NOT call fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<ImportExportTab />);

    selectFile(getImportFileInput(), jsonFile('{ not valid json'));

    expect(await screen.findByText(/isn't valid JSON/i)).toBeDefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('resets the file input value after handling a selection so the same file can be re-picked', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ version: 1, total: 1, created: 1, merged: 0, skipped: [] }),
      );
    vi.stubGlobal('fetch', fetchMock);
    render(<ImportExportTab />);

    const input = getImportFileInput();
    selectFile(input, jsonFile(JSON.stringify({ version: 1, links: [] })));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(input.value).toBe('');
  });
});
