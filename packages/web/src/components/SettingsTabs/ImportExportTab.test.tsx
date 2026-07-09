import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setApiBaseUrl } from '../../api/client';
import { exportUrl, ImportExportTab } from './ImportExportTab';

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

  it('keeps the Import row disabled', () => {
    render(<ImportExportTab />);

    const chooseFileButton = screen.getByRole('button', { name: /Choose file/i });
    expect(chooseFileButton).toHaveProperty('disabled', true);
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
