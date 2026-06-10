import { chromium, type Browser, type Page } from 'playwright';

export async function launchBrowser(headful: boolean): Promise<Browser> {
  const slowMo = Number.parseInt(process.env['JOBHELP_SLOWMO'] ?? '', 10);
  return chromium.launch({
    headless: !headful,
    ...(Number.isFinite(slowMo) && slowMo > 0 ? { slowMo } : {}),
  });
}

export async function connectBrowser(endpoint: string): Promise<Browser> {
  return chromium.connectOverCDP(endpoint);
}

/** In CDP mode pages MUST go in the daemon's default context: contexts created
 * by a connectOverCDP client are destroyed when that client disconnects, and
 * other CDP clients (the Playwright MCP) only see the default context. */
export async function newTab(browser: Browser, reuseDefaultContext = false): Promise<Page> {
  if (reuseDefaultContext) {
    const ctx = browser.contexts()[0] ?? (await browser.newContext({ acceptDownloads: false }));
    return ctx.newPage();
  }
  const ctx = await browser.newContext({ acceptDownloads: false });
  return ctx.newPage();
}
