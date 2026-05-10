/**
 * Minimal in-memory chrome.storage.local mock backed by a Map.
 *
 * Test helper used by lib + UI tests that go through the typed storage wrapper.
 * Installs itself onto globalThis.chrome and exposes reset() to clear between tests.
 */

interface StorageGetCallback {
  (items: Record<string, unknown>): void;
}

interface StorageSetCallback {
  (): void;
}

interface StorageRemoveCallback {
  (): void;
}

interface StorageClearCallback {
  (): void;
}

/** Build a fresh chrome.storage.local-compatible object backed by a Map. */
export function buildStorageMock(): {
  storage: {
    local: {
      get(
        keys: string | string[] | Record<string, unknown> | null,
        callback?: StorageGetCallback,
      ): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>, callback?: StorageSetCallback): Promise<void>;
      remove(keys: string | string[], callback?: StorageRemoveCallback): Promise<void>;
      clear(callback?: StorageClearCallback): Promise<void>;
    };
  };
  __backing: Map<string, unknown>;
  __reset(): void;
} {
  const backing = new Map<string, unknown>();

  const local = {
    async get(
      keys: string | string[] | Record<string, unknown> | null,
      callback?: StorageGetCallback,
    ): Promise<Record<string, unknown>> {
      const result: Record<string, unknown> = {};

      if (keys === null || keys === undefined) {
        // Return everything
        for (const [k, v] of backing) {
          result[k] = v;
        }
      } else if (typeof keys === 'string') {
        if (backing.has(keys)) result[keys] = backing.get(keys);
      } else if (Array.isArray(keys)) {
        for (const k of keys) {
          if (backing.has(k)) result[k] = backing.get(k);
        }
      } else {
        // Object form: keys are field names, values are defaults
        for (const [k, defaultValue] of Object.entries(keys)) {
          result[k] = backing.has(k) ? backing.get(k) : defaultValue;
        }
      }

      if (callback) callback(result);
      return result;
    },

    async set(items: Record<string, unknown>, callback?: StorageSetCallback): Promise<void> {
      for (const [k, v] of Object.entries(items)) {
        backing.set(k, v);
      }
      if (callback) callback();
    },

    async remove(keys: string | string[], callback?: StorageRemoveCallback): Promise<void> {
      const list = Array.isArray(keys) ? keys : [keys];
      for (const k of list) backing.delete(k);
      if (callback) callback();
    },

    async clear(callback?: StorageClearCallback): Promise<void> {
      backing.clear();
      if (callback) callback();
    },
  };

  return {
    storage: { local },
    __backing: backing,
    __reset() {
      backing.clear();
    },
  };
}

/**
 * Install a fresh chrome mock onto globalThis.chrome and return the harness.
 * Call __reset() between tests, or call installChromeMock() again to start fresh.
 */
export function installChromeMock(): ReturnType<typeof buildStorageMock> {
  const mock = buildStorageMock();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).chrome = mock;
  return mock;
}

// ─────────────────────────────────────────────────────────────────────────────
// Extended chrome mock — adds runtime, tabs, scripting APIs needed for
// background.ts / messageBus.ts / apiClient.ts tests.
// ─────────────────────────────────────────────────────────────────────────────

type MessageListener = (
  msg: unknown,
  sender: unknown,
  sendResponse: (response?: unknown) => void,
) => void | boolean | Promise<unknown>;

export interface ExtendedChromeMock {
  storage: ReturnType<typeof buildStorageMock>['storage'];
  __backing: Map<string, unknown>;
  __reset(): void;
  /** Call this in tests to simulate an incoming chrome.runtime.onMessage event */
  __triggerMessage(
    msg: unknown,
    sender: unknown,
    sendResponse: (response?: unknown) => void,
  ): void;
  runtime: {
    sendMessage: ReturnType<typeof vi.fn>;
    onMessage: {
      addListener: ReturnType<typeof vi.fn>;
      removeListener: ReturnType<typeof vi.fn>;
    };
  };
  tabs: {
    get: ReturnType<typeof vi.fn>;
    query: ReturnType<typeof vi.fn>;
    onActivated: {
      addListener: ReturnType<typeof vi.fn>;
    };
    onUpdated: {
      addListener: ReturnType<typeof vi.fn>;
    };
  };
  scripting: {
    executeScript: ReturnType<typeof vi.fn>;
  };
  sidePanel: {
    open: ReturnType<typeof vi.fn>;
  };
  action: {
    onClicked: {
      addListener: ReturnType<typeof vi.fn>;
    };
  };
}

import { vi } from 'vitest';

/**
 * Build an extended chrome mock that includes storage, runtime, tabs, scripting,
 * sidePanel, and action APIs. Used by background.test.ts and messageBus tests.
 */
export function buildExtendedChromeMock(): ExtendedChromeMock {
  const storageMock = buildStorageMock();
  const messageListeners: MessageListener[] = [];

  const runtime = {
    sendMessage: vi.fn().mockResolvedValue(undefined),
    onMessage: {
      addListener: vi.fn((listener: MessageListener) => {
        messageListeners.push(listener);
      }),
      removeListener: vi.fn((listener: MessageListener) => {
        const idx = messageListeners.indexOf(listener);
        if (idx !== -1) messageListeners.splice(idx, 1);
      }),
    },
  };

  const tabs = {
    get: vi.fn(),
    query: vi.fn().mockResolvedValue([]),
    onActivated: { addListener: vi.fn() },
    onUpdated: { addListener: vi.fn() },
  };

  const scripting = {
    executeScript: vi.fn(),
  };

  const sidePanel = {
    open: vi.fn().mockResolvedValue(undefined),
  };

  const action = {
    onClicked: { addListener: vi.fn() },
  };

  return {
    storage: storageMock.storage,
    __backing: storageMock.__backing,
    __reset() {
      storageMock.__reset();
      messageListeners.length = 0;
      runtime.sendMessage.mockReset().mockResolvedValue(undefined);
      runtime.onMessage.addListener.mockReset().mockImplementation((listener: MessageListener) => {
        messageListeners.push(listener);
      });
      runtime.onMessage.removeListener.mockReset().mockImplementation((listener: MessageListener) => {
        const idx = messageListeners.indexOf(listener);
        if (idx !== -1) messageListeners.splice(idx, 1);
      });
      tabs.get.mockReset();
      tabs.query.mockReset().mockResolvedValue([]);
      scripting.executeScript.mockReset();
    },
    __triggerMessage(
      msg: unknown,
      sender: unknown,
      sendResponse: (response?: unknown) => void,
    ) {
      for (const listener of messageListeners) {
        listener(msg, sender, sendResponse);
      }
    },
    runtime,
    tabs,
    scripting,
    sidePanel,
    action,
  };
}
