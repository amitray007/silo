import { vi } from 'vitest';

/**
 * A minimal in-memory mock of the `chrome.*` namespaces this extension
 * touches (`storage.local`, `tabs`, `contextMenus`, `commands`,
 * `permissions`, `scripting`). Deliberately not exhaustive — only the
 * methods this codebase actually calls, mirroring `docs/rules/testing.md`'s
 * "mock at the boundary, not the whole SDK" discipline. Call
 * `installChromeMock()` in a test's `beforeEach` (or the shared setup file)
 * to reset `globalThis.chrome` to a fresh instance.
 */
export function installChromeMock(): typeof chrome {
  const store = new Map<string, unknown>();

  const mock = {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: store.get(key) })),
        set: vi.fn(async (items: Record<string, unknown>) => {
          for (const [key, value] of Object.entries(items)) store.set(key, value);
        }),
      },
    },
    tabs: {
      query: vi.fn(async () => []),
      create: vi.fn(async () => ({})),
    },
    contextMenus: {
      create: vi.fn(),
      onClicked: { addListener: vi.fn() },
    },
    commands: {
      onCommand: { addListener: vi.fn() },
    },
    runtime: {
      onInstalled: { addListener: vi.fn() },
    },
    permissions: {
      request: vi.fn(async () => true),
    },
    scripting: {
      executeScript: vi.fn(async () => [{ result: undefined }]),
    },
    // Exposed for assertions/direct manipulation in tests.
    __store: store,
  };

  (globalThis as { chrome?: unknown }).chrome = mock;
  return mock as unknown as typeof chrome;
}
