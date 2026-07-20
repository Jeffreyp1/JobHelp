import { describe, it, expect } from 'vitest';
import type { Browser, Page } from 'playwright';
import { makeAts } from '../src/ats/make-ats.ts';
import type { AtsConfig } from '../src/ats/form-config.ts';
import { newTab, unblockPage, shouldBlockRequest } from '../src/browser.ts';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const cfg: AtsConfig = {
  name: 'fake',
  urlRe: /fake/,
  formSelector: 'form',
  submitSelector: 'button[type=submit]',
  applyButtonRe: /apply/i,
  detect: async () => [],
};

interface OpenFormFakeOpts {
  formPresent?: boolean;
  applyAttaches?: 'form' | 'control' | 'nothing';
  attachDelayMs?: number;
}

interface OpenFormFake {
  page: Page;
  events: string[];
  loadStateCalls: Array<{ state: unknown; timeout: number | undefined }>;
}

function openFormFake(opts: OpenFormFakeOpts): OpenFormFake {
  let formAttached = opts.formPresent ?? false;
  let controlAttached = false;
  const events: string[] = [];
  const loadStateCalls: Array<{ state: unknown; timeout: number | undefined }> = [];

  const until = async (cond: () => boolean, timeout: number | undefined): Promise<void> => {
    const deadline = Date.now() + Math.min(timeout ?? 500, 500);
    while (!cond()) {
      if (Date.now() > deadline) throw new Error('fake waitFor timeout');
      await sleep(5);
    }
  };

  const emptyLocator: Record<string, unknown> = {};
  emptyLocator['first'] = () => emptyLocator;
  emptyLocator['count'] = () => Promise.resolve(0);

  const formLocator: Record<string, unknown> = {};
  formLocator['first'] = () => formLocator;
  formLocator['count'] = () => Promise.resolve(formAttached ? 1 : 0);
  formLocator['waitFor'] = (o?: { state?: string; timeout?: number }) => {
    events.push(`form-wait-${o?.state ?? 'visible'}`);
    return until(() => formAttached, o?.timeout);
  };

  const readinessLocator: Record<string, unknown> = {};
  readinessLocator['first'] = () => readinessLocator;
  readinessLocator['waitFor'] = (o?: { state?: string; timeout?: number }) => {
    events.push(`readiness-wait-${o?.state ?? 'attached'}`);
    return until(() => formAttached || controlAttached, o?.timeout);
  };

  const applyLocator: Record<string, unknown> = {};
  applyLocator['first'] = () => applyLocator;
  applyLocator['count'] = () => Promise.resolve(opts.applyAttaches === undefined ? 0 : 1);
  applyLocator['click'] = () => {
    events.push('apply-click');
    const delay = opts.attachDelayMs ?? 30;
    if (opts.applyAttaches === 'form') setTimeout(() => { formAttached = true; }, delay);
    if (opts.applyAttaches === 'control') setTimeout(() => { controlAttached = true; }, delay);
    return Promise.resolve();
  };

  const page = {
    goto: () => {
      events.push('goto');
      return Promise.resolve(null);
    },
    locator: (sel: string) => {
      if (sel === 'form') return formLocator;
      if (sel === 'a, button') return applyLocator;
      if (sel.includes('input, select, textarea')) return readinessLocator;
      return emptyLocator;
    },
    waitForLoadState: (state?: unknown, o?: { timeout?: number }) => {
      loadStateCalls.push({ state, timeout: o?.timeout });
      return Promise.resolve();
    },
  } as unknown as Page;

  return { page, events, loadStateCalls };
}

describe('openForm readiness', () => {
  it('waits for a form that attaches after the apply click, then waits for it to be visible', async () => {
    const f = openFormFake({ applyAttaches: 'form', attachDelayMs: 30 });
    await makeAts(cfg).openForm(f.page, 'https://fake.test/job');
    const click = f.events.indexOf('apply-click');
    const visible = f.events.indexOf('form-wait-visible');
    expect(click).toBeGreaterThanOrEqual(0);
    expect(visible).toBeGreaterThan(click);
  });

  it('caps the hydration networkidle wait at 3s instead of a blanket 8s floor', async () => {
    const f = openFormFake({ formPresent: true });
    await makeAts(cfg).openForm(f.page, 'https://fake.test/job');
    const idle = f.loadStateCalls.find((c) => c.state === 'networkidle');
    expect(idle).toBeDefined();
    expect(idle?.timeout).toBeDefined();
    expect(idle?.timeout ?? Infinity).toBeLessThanOrEqual(3000);
  });

  it('does not click apply when the form is already present', async () => {
    const f = openFormFake({ formPresent: true });
    await makeAts(cfg).openForm(f.page, 'https://fake.test/job');
    expect(f.events).not.toContain('apply-click');
    expect(f.events).toContain('form-wait-visible');
  });

  it('a form-less SPA is ready once its first control attaches, with no form wait', async () => {
    const f = openFormFake({ applyAttaches: 'control', attachDelayMs: 30 });
    await makeAts(cfg).openForm(f.page, 'https://fake.test/job');
    expect(f.events.some((e) => e.startsWith('readiness-wait'))).toBe(true);
    expect(f.events).not.toContain('form-wait-visible');
  });

  it('still resolves when the apply click reveals nothing', async () => {
    const f = openFormFake({ applyAttaches: 'nothing' });
    await expect(makeAts(cfg).openForm(f.page, 'https://fake.test/job')).resolves.toBeUndefined();
  });
});

describe('request blocking decision', () => {
  it('blocks images, media, and fonts', () => {
    expect(shouldBlockRequest('https://jobs.example.com/logo.png', 'image')).toBe(true);
    expect(shouldBlockRequest('https://jobs.example.com/intro.mp4', 'media')).toBe(true);
    expect(shouldBlockRequest('https://jobs.example.com/brand.woff2', 'font')).toBe(true);
  });

  it('keeps css, js, documents, and xhr', () => {
    expect(shouldBlockRequest('https://jobs.example.com/app.css', 'stylesheet')).toBe(false);
    expect(shouldBlockRequest('https://jobs.example.com/app.js', 'script')).toBe(false);
    expect(shouldBlockRequest('https://boards.greenhouse.io/acme/jobs/1', 'document')).toBe(false);
    expect(shouldBlockRequest('https://boards.greenhouse.io/api/graphql', 'xhr')).toBe(false);
  });

  it('blocks analytics hosts regardless of resource type', () => {
    expect(shouldBlockRequest('https://www.googletagmanager.com/gtag/js', 'script')).toBe(true);
    expect(shouldBlockRequest('https://region1.google-analytics.com/g/collect', 'xhr')).toBe(true);
    expect(shouldBlockRequest('https://static.doubleclick.net/instream/ad.js', 'script')).toBe(true);
    expect(shouldBlockRequest('https://connect.facebook.net/en_US/fbevents.js', 'script')).toBe(true);
    expect(shouldBlockRequest('https://static.hotjar.com/c/hotjar.js', 'script')).toBe(true);
    expect(shouldBlockRequest('https://cdn.segment.com/analytics.js/v1/x/analytics.min.js', 'script')).toBe(true);
    expect(shouldBlockRequest('https://api-js.mixpanel.com/track', 'xhr')).toBe(true);
    expect(shouldBlockRequest('https://cdn.amplitude.com/libs/amplitude.js', 'script')).toBe(true);
    expect(shouldBlockRequest('https://rs.fullstory.com/rec/bundle', 'xhr')).toBe(true);
    expect(shouldBlockRequest('https://www.clarity.ms/tag/abcdef', 'script')).toBe(true);
  });

  it('never blocks captcha providers, even their images', () => {
    expect(shouldBlockRequest('https://www.gstatic.com/recaptcha/api2/logo_48.png', 'image')).toBe(false);
    expect(shouldBlockRequest('https://www.google.com/recaptcha/api.js', 'script')).toBe(false);
    expect(shouldBlockRequest('https://js.hcaptcha.com/1/api.js', 'script')).toBe(false);
    expect(shouldBlockRequest('https://imgs.hcaptcha.com/challenge.jpg', 'image')).toBe(false);
    expect(shouldBlockRequest('https://challenges.cloudflare.com/turnstile/v0/api.js', 'script')).toBe(false);
  });

  it('does not block lookalike hosts that merely end with a tracker name', () => {
    expect(shouldBlockRequest('https://mysegment.com/app.js', 'script')).toBe(false);
    expect(shouldBlockRequest('https://notclarity.ms/app.js', 'script')).toBe(false);
  });
});

interface FakeBrowser {
  browser: Browser;
  page: Page;
  routes: Array<{ pattern: unknown; handler: unknown }>;
  unroutes: Array<{ pattern: unknown; handler: unknown }>;
  newContextCalls: unknown[];
}

function fakeBrowser(existingContext: boolean): FakeBrowser {
  const routes: Array<{ pattern: unknown; handler: unknown }> = [];
  const unroutes: Array<{ pattern: unknown; handler: unknown }> = [];
  const pageObj = {
    route: (pattern: unknown, handler: unknown) => {
      routes.push({ pattern, handler });
      return Promise.resolve();
    },
    unroute: (pattern: unknown, handler: unknown) => {
      unroutes.push({ pattern, handler });
      return Promise.resolve();
    },
  };
  const ctx = { newPage: () => Promise.resolve(pageObj) };
  const newContextCalls: unknown[] = [];
  const browserObj = {
    contexts: () => (existingContext ? [ctx] : []),
    newContext: (opts?: unknown) => {
      newContextCalls.push(opts);
      return Promise.resolve(ctx);
    },
  };
  return {
    browser: browserObj as unknown as Browser,
    page: pageObj as unknown as Page,
    routes,
    unroutes,
    newContextCalls,
  };
}

describe('newTab request interception', () => {
  it('isolated tabs block service workers and register the noise route', async () => {
    const f = fakeBrowser(false);
    await newTab(f.browser, false);
    expect(f.newContextCalls).toEqual([{ acceptDownloads: false, serviceWorkers: 'block' }]);
    expect(f.routes).toHaveLength(1);
    expect(f.routes[0]?.pattern).toBe('**/*');
  });

  it('CDP tabs reuse the daemon context and still register the route', async () => {
    const f = fakeBrowser(true);
    await newTab(f.browser, true);
    expect(f.newContextCalls).toEqual([]);
    expect(f.routes).toHaveLength(1);
  });

  it('the CDP fallback context never passes the serviceWorkers option', async () => {
    const f = fakeBrowser(false);
    await newTab(f.browser, true);
    expect(f.newContextCalls).toEqual([{ acceptDownloads: false }]);
  });

  it('unblockPage unroutes the exact pattern and handler newTab registered', async () => {
    const f = fakeBrowser(false);
    const page = await newTab(f.browser, false);
    await unblockPage(page);
    expect(f.unroutes).toHaveLength(1);
    expect(f.unroutes[0]?.pattern).toBe(f.routes[0]?.pattern);
    expect(f.unroutes[0]?.handler).toBe(f.routes[0]?.handler);
  });
});
