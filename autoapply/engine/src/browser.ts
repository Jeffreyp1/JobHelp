import { chromium, type Browser, type Page, type Route } from 'playwright';

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

const BLOCKED_RESOURCE_TYPES = new Set(['image', 'media', 'font']);

// Aborting a captcha asset (challenge images come from gstatic/hcaptcha as
// resourceType image) breaks the widget and strands the application, so captcha
// traffic is exempt before any other rule.
const CAPTCHA_URL_RE = /recaptcha|gstatic\.com|hcaptcha|turnstile|challenges\.cloudflare\.com/i;

const ANALYTICS_HOST_RE =
  /(^|\.)(googletagmanager\.com|google-analytics\.com|doubleclick\.net|facebook\.(com|net)|hotjar\.com|segment\.(io|com)|mixpanel\.com|amplitude\.com|fullstory\.com|clarity\.ms)$/i;

export function shouldBlockRequest(url: string, resourceType: string): boolean {
  if (CAPTCHA_URL_RE.test(url)) return false;
  if (BLOCKED_RESOURCE_TYPES.has(resourceType)) return true;
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return false;
  }
  return ANALYTICS_HOST_RE.test(host);
}

async function blockNoise(route: Route): Promise<void> {
  const req = route.request();
  if (shouldBlockRequest(req.url(), req.resourceType())) await route.abort();
  else await route.continue();
}

const NOISE_ROUTE_PATTERN = '**/*';

/** In CDP mode pages MUST go in the daemon's default context: contexts created
 * by a connectOverCDP client are destroyed when that client disconnects, and
 * other CDP clients (the Playwright MCP) only see the default context. That
 * also means serviceWorkers:'block' is only possible on the isolated path —
 * it is a context-creation option. */
export async function newTab(browser: Browser, reuseDefaultContext = false): Promise<Page> {
  const ctx = reuseDefaultContext
    ? browser.contexts()[0] ?? (await browser.newContext({ acceptDownloads: false }))
    : await browser.newContext({ acceptDownloads: false, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  // Images/media/fonts and analytics beacons dominate career pages and keep
  // networkidle from ever firing; CSS/JS stay — react-select rendering and
  // actionability checks need them. Routed per page, not per context: the CDP
  // default context is shared across tabs, and unblocking one parked tab must
  // not unblock (or stack handlers on) its siblings.
  await page.route(NOISE_ROUTE_PATTERN, blockNoise);
  return page;
}

/** Restore full network before a tab is parked so human review sees the real
 * page. Do not reload — a reload would wipe the filled form values; only
 * requests issued after this call (e.g. the post-submit page) load unblocked. */
export async function unblockPage(page: Page): Promise<void> {
  await page.unroute(NOISE_ROUTE_PATTERN, blockNoise);
}
