import type { Locator, Page } from 'playwright';

const DEFAULT_SUBMIT_CONFIRM_MS = 8000;
export const submitConfirmMs = (): number => Number(process.env.JOBHELP_SUBMIT_CONFIRM_MS) || DEFAULT_SUBMIT_CONFIRM_MS;

export const SUCCESS_TEXT_RE =
  /thank you|application (was )?(received|submitted|sent)|we('| ha)?ve received|submitted successfully|successfully (applied|submitted)/i;

/** Thrown by submit() when the click produced no observable success signal. The
 * orchestrator treats this as terminal-but-unverified (do not retry: the send may
 * have gone through) — distinct from a click failure, which is retryable. */
export const SUBMIT_NOT_CONFIRMED = 'submit not confirmed';

/** Wait for a real success signal after the submit click: a navigation away, a
 * NEW confirmation message, or the form detaching. `startUrl` and `successBefore`
 * are sampled BEFORE the click so pre-existing page copy (a "thank you for your
 * interest" blurb) can't be mistaken for proof of a send. The form may detach on
 * success, so a per-poll timeout swallows detached-frame errors. */
export async function awaitSubmitConfirmed(
  page: Page,
  form: Locator,
  startUrl: string,
  successBefore: boolean,
  deadline: number,
): Promise<boolean> {
  const success = page.locator('body', { hasText: SUCCESS_TEXT_RE });
  while (Date.now() < deadline) {
    if (page.url() !== startUrl) return true;
    if (!successBefore && (await success.count().catch(() => 0)) > 0) return true;
    if (!(await form.isVisible().catch(() => false))) return true;
    await page.waitForTimeout(150);
  }
  return false;
}
