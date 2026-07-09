import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeMock } from '../test-support/chrome-mock.js';

describe('service worker registration', () => {
  beforeEach(() => {
    vi.resetModules();
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
});
