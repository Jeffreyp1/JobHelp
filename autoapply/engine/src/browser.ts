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

export async function newTab(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext({ acceptDownloads: false });
  return ctx.newPage();
}
