/**
 * messageBus.ts
 *
 * Typed wrapper over chrome.runtime.sendMessage and chrome.runtime.onMessage.
 * All cross-context messages (background ↔ side panel) flow through these
 * helpers so that TypeScript can enforce message shapes at compile time.
 */

import type { Message, MessageType, MessageOf } from '../types/message-bus.js';

/** Access chrome via globalThis so tests can stub it. */
function getChrome(): typeof chrome {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (globalThis as any).chrome as typeof chrome;
}

/**
 * Send a typed message to the extension runtime (background or side panel).
 * Ignores "Could not establish connection" errors that are normal when the
 * side panel is not yet open.
 */
export async function send<T extends MessageType>(message: MessageOf<T>): Promise<void> {
  try {
    const c = getChrome();
    await c.runtime.sendMessage(message as Message);
  } catch (err) {
    // In MV3 it's normal to get "Could not establish connection" when the
    // receiver (side panel) is closed.  Swallow silently.
    const msg = (err as Error)?.message ?? '';
    if (!msg.includes('Could not establish connection')) {
      throw err;
    }
  }
}

/**
 * Register a typed message listener. The handler fires only for messages
 * whose `type` field matches the requested type; other messages are ignored.
 *
 * Returns an unsubscribe function that removes the listener.
 */
export function on<T extends MessageType>(
  type: T,
  handler: (msg: MessageOf<T>) => void | Promise<void>,
): () => void {
  const c = getChrome();

  function listener(
    msg: unknown,
    _sender: chrome.runtime.MessageSender,
    _sendResponse: (response?: unknown) => void,
  ): void | boolean {
    if (
      msg !== null &&
      typeof msg === 'object' &&
      (msg as Message).type === type
    ) {
      void handler(msg as MessageOf<T>);
    }
  }

  c.runtime.onMessage.addListener(listener);

  // Return unsubscribe
  return () => {
    c.runtime.onMessage.removeListener(listener);
  };
}
