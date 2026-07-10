import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccessTab } from './AccessTab';

describe('AccessTab (HTTP MCP + API key)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('"Copy config" writes the HTTP+bearer MCP config to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });

    render(<AccessTab />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy config' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copied = writeText.mock.calls[0]?.[0] as string;

    // The new HTTP+bearer shape.
    expect(copied).toContain('/mcp');
    expect(copied).toContain('Authorization');
    expect(copied).toContain('Bearer');
    expect(copied).toContain('<YOUR_SILO_API_TOKEN>');

    // Never the old stdio subprocess config.
    expect(copied).not.toContain('"command"');
    expect(copied).not.toContain('"args"');
    expect(copied).not.toContain('pnpm');

    // Never a real token value.
    expect(copied).not.toMatch(/Bearer (?!<YOUR_SILO_API_TOKEN>)\S+/);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Copied' })).toBeDefined());
  });

  it('flashes "Couldn\'t copy" when the clipboard write fails, and resets after', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    vi.stubGlobal('navigator', { clipboard: { writeText } });

    render(<AccessTab />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy config' }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: "Couldn't copy" })).toBeDefined(),
    );

    vi.advanceTimersByTime(1500);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copy config' })).toBeDefined());

    vi.useRealTimers();
  });

  it('the access token row explains the env-secret model and shows no real token', () => {
    render(<AccessTab />);

    expect(screen.getByText('Access token')).toBeDefined();
    expect(screen.getByText(/silo never shows it here/i)).toBeDefined();
    expect(screen.getAllByText(/SILO_API_TOKEN/).length).toBeGreaterThan(0);

    // The old "Rotate" affordance implied a generate/rotate action that
    // doesn't exist for an env secret — must be gone.
    expect(screen.queryByRole('button', { name: 'Rotate' })).toBeNull();
  });

  it('the MCP access row describes HTTP availability accurately and stays disabled (no live backend toggle)', () => {
    render(<AccessTab />);

    expect(screen.getByText(/SILO_MCP_HTTP_PORT/)).toBeDefined();
    const toggle = screen.getByTitle(/SILO_MCP_HTTP_PORT \+ SILO_API_TOKEN/);
    expect(toggle).toHaveProperty('disabled', true);
  });
});
