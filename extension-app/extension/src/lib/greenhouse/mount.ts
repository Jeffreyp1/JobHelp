/**
 * Keeps an injected element attached. SPA frameworks (the Greenhouse job-boards
 * embed is React/Remix) remove "foreign" nodes from the subtree they manage, so
 * the content script appends to `<html>` and re-appends on removal via this
 * helper, driven by a MutationObserver.
 */

/** Re-append `panel` to `parent` if it is no longer in the document. Returns
 * true if it had to re-attach. */
export function remountIfDetached(panel: HTMLElement, parent: Element): boolean {
  if (panel.isConnected) return false;
  parent.appendChild(panel);
  return true;
}
