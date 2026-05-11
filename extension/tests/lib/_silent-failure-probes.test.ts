/** @vitest-environment jsdom */
/**
 * _silent-failure-probes.test.ts
 *
 * Targeted unit tests probing silent-failure modes in extension library code.
 * Each test either:
 *   - PASSES with a `// SILENT BEHAVIOR:` comment describing what we confirmed
 *     (i.e. the silent behavior is acceptable / documented).
 *   - FAILS revealing a real bug (bug fix is a follow-up commit).
 *
 * Modules probed:
 *   - apiClient.post (non-JSON 200 body)
 *   - configLoader (base64 → non-UTF8 bytes)
 *   - templateFiller (markdown with 0 sections)
 *   - costCalculator (unknown model id)
 *   - storage.get  (chrome.storage undefined)
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { ApiClient } from '../../src/lib/apiClient';
import { loadConfigFromDrive, clearConfigCache } from '../../src/lib/configLoader';
import {
  parseResumeMarkdown,
  fillResumeTemplate,
  type ResumeData,
} from '../../src/lib/templateFiller';
import { estimateCost } from '../../src/lib/costCalculator';
import { get, set } from '../../src/lib/storage';
import { ConfigValidationError } from '../../src/types/jobhelp-config';
import type { ApiClient as ApiClientType } from '../../src/lib/apiClient';

const URL = 'https://script.google.com/macros/s/FAKE/exec';

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─────────────────────────────────────────────────────────────────────────────
// apiClient.post — what happens with non-JSON success body?
// ─────────────────────────────────────────────────────────────────────────────

describe('apiClient.post — non-JSON 200 body', () => {
  it('S1: HTTP 200 with non-JSON body — apiClient surfaces the JSON parse error, not silently returns undefined', async () => {
    // Server returns 200 + plain-text body. response.json() throws.
    // The current implementation does `return response.json() as Promise<T>`
    // — it never catches that throw. Probe: does the caller get a rejection
    // (loud) or some silent return-undefined behavior?
    const jsonError = new SyntaxError('Unexpected token < in JSON at position 0');
    const response = {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: vi.fn().mockRejectedValue(jsonError),
    } as unknown as Response;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));

    const client = new ApiClient(URL);

    // The expected SAFE behavior: rejection (a loud error the caller can
    // surface to the user). If the call resolves silently with undefined or
    // any shape that lacks `ok`, that's a silent failure (UI would interpret
    // it as success and crash later).
    let caught: unknown = null;
    let result: unknown = null;
    try {
      result = await client.ping();
    } catch (err) {
      caught = err;
    }

    // The current behavior (no try/catch around response.json()) is that the
    // SyntaxError propagates up as a rejection. Assert that explicitly.
    expect(caught).toBeInstanceOf(SyntaxError);
    expect(result).toBeNull();
    // SILENT BEHAVIOR: apiClient.post does NOT catch the SyntaxError from
    // JSON.parse on a 200 OK response — it propagates as an uncaught
    // rejection. Acceptable in current callers (they wrap in try/catch),
    // but should be normalized into the ApiResponse shape (ok:false,
    // error: server) for symmetry with the 4xx/5xx and network-error paths.
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// configLoader — base64 that decodes to non-UTF8 bytes
// ─────────────────────────────────────────────────────────────────────────────

describe('configLoader — non-UTF8 base64 payload', () => {
  beforeEach(() => {
    clearConfigCache();
  });

  it('S2: base64 that decodes to invalid UTF-8 → loud ConfigValidationError, not a silent garbled config', async () => {
    // Lone continuation byte 0x80 + ASCII; not valid UTF-8. TextDecoder
    // by default REPLACES with U+FFFD instead of throwing. That means
    // decodeBase64ToUtf8 will silently produce garbage text, which then
    // fails JSON.parse — i.e. the error is "Config file is not valid JSON"
    // rather than a clear "binary content" message. We assert the loud-fail
    // behavior: any ConfigValidationError is acceptable; silently returning
    // a config is a bug.
    // Build base64 of bytes: 0x80 0x7b 0x7d  (continuation byte then "{}")
    const bytes = new Uint8Array([0x80, 0x7b, 0x7d]);
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    const badBase64 = btoa(binary);

    const downloadTemplate = vi.fn().mockResolvedValue({
      ok: true,
      base64: badBase64,
      fileName: 'jobhelp-config.json',
      mimeType: 'application/json',
    });
    const client = { downloadTemplate } as unknown as ApiClientType;

    let caught: unknown = null;
    let resolved = false;
    try {
      await loadConfigFromDrive('file-1', client);
      resolved = true;
    } catch (err) {
      caught = err;
    }

    // Either flavor of loud failure is fine. Silent resolution = bug.
    expect(resolved).toBe(false);
    expect(caught).toBeInstanceOf(ConfigValidationError);
    // SILENT BEHAVIOR: TextDecoder defaults (fatal:false) replace invalid
    // UTF-8 with U+FFFD rather than throwing. The garbled output then fails
    // JSON.parse, surfacing as a ConfigValidationError with a "not valid
    // JSON" message rather than a clearer "binary file?" message. The
    // failure is still LOUD (rejects with ConfigValidationError), so we
    // tolerate this for now — but the error message is misleading.
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// templateFiller — markdown with 0 sections (no ## headings)
// ─────────────────────────────────────────────────────────────────────────────

describe('templateFiller.parseResumeMarkdown — 0-section markdown', () => {
  it('S3: markdown with zero ## sections returns an EMPTY ResumeData, never throws', () => {
    // The parser walks lines, only collecting non-empty header lines into
    // headerLines until a "##" appears. If there are NO ## headings, all
    // lines become headerLines and every section array is empty.
    // Probe: does it silently produce a usable (but empty) ResumeData?
    const data = parseResumeMarkdown('# Jane Doe\njane@example.com');

    // Probe: header parsed?
    expect(data.name).toBe('Jane Doe');
    expect(data.contact).toBe('jane@example.com');

    // SILENT BEHAVIOR: All section arrays are empty when no ## headings
    // appear. parser produces a ResumeData with empty sections — does NOT
    // throw, does NOT warn. Callers downstream (fillResumeTemplate, UI) will
    // render an empty resume. Document this as expected, but flag that the
    // ResumeData carries no signal back to callers about "0 sections found".
    expect(data.skills).toEqual([]);
    expect(data.experiences).toEqual([]);
    expect(data.projects).toEqual([]);
    expect(data.education).toEqual([]);
  });

  it('S4: completely empty markdown ("") returns empty ResumeData with empty name/contact', () => {
    // Probe: does empty input crash, or silently produce a blank ResumeData
    // that would render as an empty doc downstream?
    const data = parseResumeMarkdown('');

    // SILENT BEHAVIOR: empty markdown returns a fully-empty ResumeData
    // (name='', contact='', all section arrays empty). The downstream
    // template-fill step would silently produce a DOCX with no content
    // — there's no upstream signal that the markdown was empty. Logging
    // a warning here would help, but the current behavior is documented.
    expect(data.name).toBe('');
    expect(data.contact).toBe('');
    expect(data.skills).toEqual([]);
    expect(data.experiences).toEqual([]);
    expect(data.projects).toEqual([]);
    expect(data.education).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// costCalculator — unknown model id
// ─────────────────────────────────────────────────────────────────────────────

describe('costCalculator.estimateCost — unknown model id', () => {
  it('S5: unknown model id falls back to default haiku pricing (silent, no warning, no NaN)', () => {
    // Probe: what happens with a typo'd model name?
    // costCalculator's costFor uses `PRICING_PER_M[modelId] ?? DEFAULT_PRICING`
    // — so an unknown model SILENTLY uses haiku pricing.
    // Expectation: we'd prefer a console.warn or a throw so the user
    // doesn't get a wrong cost estimate. But the current contract is
    // silent fallback. Probe + assert; flag as a silent failure.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const haikuCost = estimateCost({}, 'claude-haiku-4-5-20251001');
    const unknownCost = estimateCost({}, 'claude-fictional-9000');

    expect(haikuCost.total).toBeGreaterThan(0);
    expect(Number.isFinite(unknownCost.total)).toBe(true);
    expect(Number.isNaN(unknownCost.total)).toBe(false);

    // Same fallback → identical numbers.
    expect(unknownCost.total).toBeCloseTo(haikuCost.total, 6);

    // SILENT BEHAVIOR: unknown model id silently uses DEFAULT_PRICING
    // (haiku). console.warn is never called. The user's cost preview will
    // be WRONG by up to 75x if they typed an Opus model name with a typo.
    // This is a documented silent failure — fix would be a one-line
    // console.warn in costFor() when the lookup misses.
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// storage.get — chrome.storage undefined (extension test env)
// ─────────────────────────────────────────────────────────────────────────────

describe('storage.get — chrome.storage missing', () => {
  it('S6: get(key) when chrome global is undefined → returns the schema default, does NOT throw', async () => {
    // The wrapper checks `hasChromeStorage()` and falls back to
    // STORAGE_DEFAULTS[key] when chrome.storage is missing. Probe: does the
    // fallback path silently fire, or does the wrapper throw?
    // Important: this is the "user opens the extension outside the Chrome
    // runtime" or "test env without installChromeMock" case.

    // Ensure no chrome global exists.
    delete (globalThis as { chrome?: unknown }).chrome;

    // For a key with a known default (defaultGenerateModel = haiku id):
    const v = await get('defaultGenerateModel');

    // SILENT BEHAVIOR: storage.get returns the schema default silently when
    // chrome.storage is absent. No console.warn. No throw. This is correct
    // for legit users (extension always has chrome.storage), but it masks
    // misconfiguration in tests that forgot to install the mock —
    // every key reads its default, the UI shows "no settings", and the
    // developer doesn't see a warning until much later when an API call
    // tries to POST with an empty appsScriptUrl.
    expect(v).toBe('claude-haiku-4-5-20251001');
  });

  it('S7: set(key, value) when chrome global is undefined → silently no-ops, does NOT throw', async () => {
    delete (globalThis as { chrome?: unknown }).chrome;

    // Probe: does writing to storage in a chrome-less env throw, or silently
    // do nothing? Either is defensible — assert the actual behavior.
    let caught: unknown = null;
    try {
      await set('jobhelpConfigFileId', 'fake-file-id');
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeNull();
    // SILENT BEHAVIOR: set() returns undefined and swallows the write when
    // chrome.storage is missing. A subsequent get() returns the default
    // (the value just written is NOT persisted anywhere). This is a true
    // silent-failure surface — a test that forgets to install the mock
    // will see writes appear to succeed but reads return defaults.
    const readback = await get('jobhelpConfigFileId');
    expect(readback).toBeNull(); // schema default; the set didn't stick
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// templateFiller.fillResumeTemplate — corrupt template bytes
// ─────────────────────────────────────────────────────────────────────────────

describe('templateFiller.fillResumeTemplate — corrupt template', () => {
  it('S8: malformed (non-zip) template bytes → throws a wrapped Error with diagnostic context', async () => {
    // Probe: what happens if we hand the filler arbitrary bytes that aren't a
    // valid .docx zip? It SHOULD throw a meaningful error so the UI shows
    // "your template is corrupt", not silently produce an empty Blob.
    const bogus = new TextEncoder().encode('not-a-zip-at-all-just-text').buffer;

    const data: ResumeData = {
      name: 'Test',
      contact: 'test@example.com',
      skills: [],
      experiences: [],
      projects: [],
      education: [],
    };

    let caught: unknown = null;
    try {
      await fillResumeTemplate(bogus, data);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Error);
    expect(String((caught as Error).message)).toMatch(/templateFiller/);
    // SILENT BEHAVIOR: fillResumeTemplate correctly throws a wrapped Error
    // with the "templateFiller:" prefix for ALL three failure modes (zip
    // parse, compile, render). The message includes the inner error so a
    // UI banner can show a useful diagnostic. No silent Blob is returned.
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// costCalculator — multi-version with count=0 silently zeroes out
// ─────────────────────────────────────────────────────────────────────────────

describe('costCalculator — multiVersion count zero / negative edges', () => {
  it('S9: multiVersionEnabled=true + count=0 silently estimates $0 for that slice (no validation error)', () => {
    // Probe: the user accidentally sets the count picker to 0 (or it
    // restores from storage as 0). The cost calculator multiplies the
    // per-variant cost by count, so count=0 → $0 for multi-version. But
    // count=0 is also invalid at the backend (validate requires 2-5).
    // We'd want a loud signal here so the UI can show "count must be 2-5".
    const cost = estimateCost({}, 'claude-haiku-4-5-20251001', {
      multiVersionEnabled: true,
      multiVersionModel: 'claude-sonnet-4-6',
      multiVersionCount: 0,
    });
    expect(cost.multiVersion).toBe(0);
    // SILENT BEHAVIOR: count=0 is silently accepted by estimateCost and
    // produces a $0 multi-version slice. The backend handler will then
    // reject the request (validateMultiVersion requires 2..5). The user
    // sees "$0 multi-version", clicks Generate, and only THEN gets a
    // validation error from the server. The cost preview should ideally
    // mirror server-side bounds, but the current behavior is documented.
  });

  it('S10: multiVersionEnabled=true + count=-5 (negative) clamps to 0, never produces a negative cost', () => {
    // Probe: storage corruption / direct user injection — what if count is
    // negative? The Math.max(0, count) clamp in costCalculator handles this,
    // but ONLY if Math.max is reached BEFORE the multiplication. Let's
    // verify the clamp is reachable.
    const cost = estimateCost({}, 'claude-haiku-4-5-20251001', {
      multiVersionEnabled: true,
      multiVersionModel: 'claude-sonnet-4-6',
      multiVersionCount: -5,
    });

    // SILENT BEHAVIOR: Math.max(0, count) clamps negatives to 0 silently,
    // and the multi-version slice becomes $0. No console.warn, no throw.
    expect(cost.multiVersion).toBe(0);
    expect(cost.multiVersion).toBeGreaterThanOrEqual(0);
  });
});
