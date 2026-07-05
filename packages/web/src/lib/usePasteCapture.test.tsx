import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isTextEntryElement, usePasteCapture } from './usePasteCapture';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** A tiny host component so `usePasteCapture` (an effect-only hook with no return value) can be mounted under a real `QueryClientProvider`, matching how `AppFrame` actually uses it. */
function PasteCaptureHost() {
  usePasteCapture();
  return (
    <div>
      <input placeholder="a real input" />
      <div contentEditable="true" data-testid="editable" />
    </div>
  );
}

function renderHost() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <PasteCaptureHost />
    </QueryClientProvider>,
  );
}

/**
 * Builds a plain `Event` shaped like a `ClipboardEvent` carrying `text` as its
 * `text/plain` clipboard data. jsdom (this project's test environment)
 * implements neither the `ClipboardEvent`/`DataTransfer` constructors NOR a
 * real paste-event `clipboardData` — so this fakes the one method the hook
 * actually calls (`clipboardData.getData('text/plain')`) rather than trying
 * to construct a spec-accurate `DataTransfer`.
 */
function pasteEventWith(text: string): ClipboardEvent {
  const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
  Object.defineProperty(event, 'clipboardData', {
    value: { getData: (type: string) => (type === 'text/plain' ? text : '') },
  });
  return event;
}

describe('usePasteCapture', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ id: 'new-link' }, 201)));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('captures a pasted URL when nothing is focused (paste "onto the page")', async () => {
    renderHost();
    act(() => {
      document.dispatchEvent(pasteEventWith('https://example.com/paste-test'));
    });

    await vi.waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        '/api/links',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ url: 'https://example.com/paste-test' }),
        }),
      ),
    );
  });

  it('silently ignores a paste that does not look like a URL — no capture, no error', () => {
    renderHost();
    act(() => {
      document.dispatchEvent(pasteEventWith('just some regular text'));
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not hijack a paste into a real <input> — the field keeps the paste, no capture fires', () => {
    renderHost();
    const input = screen.getByPlaceholderText('a real input');
    input.focus();
    act(() => {
      input.dispatchEvent(pasteEventWith('https://example.com/should-not-capture'));
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not hijack a paste into a contenteditable element', () => {
    renderHost();
    const editable = screen.getByTestId('editable');
    editable.focus();
    act(() => {
      editable.dispatchEvent(pasteEventWith('https://example.com/should-not-capture'));
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('ignores an empty clipboard paste', () => {
    renderHost();
    act(() => {
      document.dispatchEvent(pasteEventWith(''));
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('isTextEntryElement', () => {
  it('is false for null/non-element targets', () => {
    expect(isTextEntryElement(null)).toBe(false);
  });

  it('is true for <input> and <textarea>', () => {
    expect(isTextEntryElement(document.createElement('input'))).toBe(true);
    expect(isTextEntryElement(document.createElement('textarea'))).toBe(true);
  });

  it('is true for a contenteditable element', () => {
    // Sets the ATTRIBUTE directly (not the `contentEditable` IDL property) —
    // jsdom's `contentEditable` setter is a no-op stub that never reflects to
    // the attribute, and `isTextEntryElement` itself reads the attribute (see
    // its doc comment for why).
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    document.body.appendChild(editable);
    expect(isTextEntryElement(editable)).toBe(true);
    editable.remove();
  });

  it('is true for a contenteditable="plaintext-only" element', () => {
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'plaintext-only');
    document.body.appendChild(editable);
    expect(isTextEntryElement(editable)).toBe(true);
    editable.remove();
  });

  it('is false for a plain, non-editable element', () => {
    expect(isTextEntryElement(document.createElement('div'))).toBe(false);
  });
});
