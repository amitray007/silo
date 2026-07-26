import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeMock } from '../test-support/chrome-mock.js';
import * as captureFlow from './capture-flow.js';

vi.mock('./capture-flow.js', () => ({
  captureActiveTab: vi.fn(async () => {}),
  captureTab: vi.fn(async () => {}),
}));

describe('service worker registration', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    const chrome = installChromeMock();
    // add the action namespace the mock doesn't yet have
    (
      chrome as unknown as { action: { onClicked: { addListener: ReturnType<typeof vi.fn> } } }
    ).action = {
      onClicked: { addListener: vi.fn() },
    };
  });

  it('registers an action.onClicked listener', async () => {
    await import('./service-worker.js');
    const listener = (
      globalThis.chrome as unknown as {
        action: { onClicked: { addListener: ReturnType<typeof vi.fn> } };
      }
    ).action.onClicked.addListener;
    expect(listener).toHaveBeenCalledOnce();
  });

  it('captures the toolbar click tab snapshot instead of re-querying the active tab', async () => {
    await import('./service-worker.js');
    const addListener = (
      globalThis.chrome as unknown as {
        action: { onClicked: { addListener: ReturnType<typeof vi.fn> } };
      }
    ).action.onClicked.addListener;
    const listener = addListener.mock.calls[0]?.[0] as ((tab: chrome.tabs.Tab) => void) | undefined;
    const clickedTab = {
      id: 7,
      url: 'https://clicked.example',
      title: 'Clicked page',
    } as chrome.tabs.Tab;

    listener?.(clickedTab);

    expect(captureFlow.captureTab).toHaveBeenCalledWith(clickedTab);
    expect(captureFlow.captureActiveTab).not.toHaveBeenCalled();
  });

  it('captures the keyboard-command tab snapshot when Chrome supplies one', async () => {
    await import('./service-worker.js');
    const addListener = (
      globalThis.chrome as unknown as {
        commands: { onCommand: { addListener: ReturnType<typeof vi.fn> } };
      }
    ).commands.onCommand.addListener;
    const listener = addListener.mock.calls[0]?.[0] as
      | ((command: string, tab?: chrome.tabs.Tab) => void)
      | undefined;
    const commandTab = {
      id: 8,
      url: 'https://shortcut.example',
      title: 'Shortcut page',
    } as chrome.tabs.Tab;

    listener?.('capture-page', commandTab);

    expect(captureFlow.captureTab).toHaveBeenCalledWith(commandTab);
    expect(captureFlow.captureActiveTab).not.toHaveBeenCalled();
  });

  it('loads tag suggestions only when the edit card requests them', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ tags: [{ name: 'reading', count: 2 }] }), {
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    await import('./service-worker.js');
    const addListener = (
      globalThis.chrome as unknown as {
        runtime: { onMessage: { addListener: ReturnType<typeof vi.fn> } };
      }
    ).runtime.onMessage.addListener;
    const listener = addListener.mock.calls[0]?.[0] as
      | ((
          message: { type: string },
          sender: chrome.runtime.MessageSender,
          sendResponse: (response: unknown) => void,
        ) => boolean)
      | undefined;
    const sendResponse = vi.fn();

    const keepsChannelOpen = listener?.(
      { type: 'silo-list-tags' },
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );

    expect(keepsChannelOpen).toBe(true);
    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({
        ok: true,
        tags: [{ name: 'reading', count: 2 }],
      });
    });
  });
});
