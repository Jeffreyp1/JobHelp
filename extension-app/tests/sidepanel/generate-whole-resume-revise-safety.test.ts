/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderGenerateTab, type GenerateTabHooks } from '../../extension/src/sidepanel/tabs/generate';
import type { AutoReviseResponse } from '../../extension/src/types/api-contract';

const HAIKU = 'claude-haiku-4-5-20251001';

const INITIAL_MD = [
  '# Jordan Rivera',
  '',
  '## Experience',
  '',
  '- Built APIs.',
  '',
].join('\n');

const SUBMIT_TIME_MD = [
  '# Jordan Rivera',
  '',
  '## Experience',
  '',
  '- Built APIs with tests.',
  '',
].join('\n');

const LIVE_EDIT_MD = [
  '# Jordan Rivera',
  '',
  '## Experience',
  '',
  '- Built APIs with tests and local edits.',
  '',
].join('\n');

const REVISED_MD = [
  '# Jordan Rivera',
  '',
  '## Experience',
  '',
  '- Built resilient APIs with test coverage.',
  '',
].join('\n');

type ChromeStorageKey = string | readonly string[] | Record<string, unknown> | null | undefined;

function installChromeStorageMock(): void {
  const store = new Map<string, unknown>();
  const get = vi.fn(async (key?: ChromeStorageKey): Promise<Record<string, unknown>> => {
    if (typeof key === 'string') return { [key]: store.get(key) };
    if (Array.isArray(key)) {
      const out: Record<string, unknown> = {};
      for (const item of key) out[item] = store.get(item);
      return out;
    }
    if (key && typeof key === 'object') {
      const out: Record<string, unknown> = {};
      for (const [item, fallback] of Object.entries(key)) out[item] = store.get(item) ?? fallback;
      return out;
    }
    return Object.fromEntries(store.entries());
  });
  const set = vi.fn(async (items: Record<string, unknown>): Promise<void> => {
    for (const [key, value] of Object.entries(items)) store.set(key, value);
  });

  vi.stubGlobal('chrome', {
    storage: {
      local: { get, set },
    },
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function buildHooks(overrides: Partial<GenerateTabHooks> = {}): GenerateTabHooks {
  return {
    onGenerate: vi.fn().mockResolvedValue(undefined),
    onSaveResume: vi.fn().mockResolvedValue(undefined),
    onFinalize: vi.fn().mockResolvedValue({ ok: false, message: 'stub' }),
    ...overrides,
  };
}

async function flush(times = 4): Promise<void> {
  for (let i = 0; i < times; i++) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

function reviseResponse(markdown: string): AutoReviseResponse {
  return {
    ok: true,
    revisedMarkdown: markdown,
    diff: [{ lineIndex: 4, before: '- Built APIs.', after: '- Built resilient APIs with test coverage.' }],
    unauthorizedChanges: [],
    cost: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0, totalUsd: 0.001 },
  };
}

function rawTextarea(root: HTMLElement): HTMLTextAreaElement {
  const textarea = root.querySelector<HTMLTextAreaElement>('.resume-editor__raw-textarea');
  if (!textarea) throw new Error('raw textarea not found');
  return textarea;
}

async function openComposer(root: HTMLElement): Promise<void> {
  root.querySelector<HTMLButtonElement>('button.revise-whole-resume')?.click();
  await flush();
}

async function submitComposer(root: HTMLElement, instruction: string): Promise<void> {
  const input = root.querySelector<HTMLTextAreaElement>('.revise-composer__instruction');
  if (!input) throw new Error('revise composer not found');
  input.value = instruction;
  input.dispatchEvent(new Event('input'));
  root.querySelector<HTMLButtonElement>('.revise-composer button[data-action="submit"]')?.click();
  await flush();
}

function editRawMarkdown(root: HTMLElement, markdown: string): void {
  const textarea = rawTextarea(root);
  textarea.value = markdown;
  textarea.dispatchEvent(new Event('input'));
}

describe('renderGenerateTab whole-resume revise safety', () => {
  beforeEach(() => {
    installChromeStorageMock();
    if (!('requestAnimationFrame' in window)) {
      vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => window.setTimeout(cb, 0));
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it('shows a diff and waits for Accept before applying a whole-resume response', async () => {
    const pending = deferred<AutoReviseResponse>();
    const onAutoRevise = vi.fn().mockReturnValue(pending.promise);
    const ctrl = renderGenerateTab(buildHooks({ onAutoRevise }));
    document.body.appendChild(ctrl.root);
    ctrl.showResume(INITIAL_MD);
    await flush();

    await openComposer(ctrl.root);
    await submitComposer(ctrl.root, 'tighten the resume');
    pending.resolve(reviseResponse(REVISED_MD));
    await flush();

    expect(rawTextarea(ctrl.root).value).toBe(INITIAL_MD);
    expect(ctrl.root.querySelector('.revise-diff')?.textContent).toContain('- Built APIs.');
    expect(ctrl.root.querySelector('.revise-diff')?.textContent).toContain(
      '- Built resilient APIs with test coverage.',
    );
    const accept = ctrl.root.querySelector<HTMLButtonElement>('.revise-diff button[data-action="accept"]');
    expect(accept).not.toBeNull();
    expect(ctrl.root.querySelector('.revise-diff button[data-action="reject"]')).not.toBeNull();

    accept?.click();
    await flush();

    expect(rawTextarea(ctrl.root).value).toBe(REVISED_MD);
    expect(ctrl.root.querySelector('.revise-diff')).toBeNull();
  });

  it('uses submit-time markdown and blocks Accept after an in-flight editor change', async () => {
    const pending = deferred<AutoReviseResponse>();
    const onAutoRevise = vi.fn().mockReturnValue(pending.promise);
    const ctrl = renderGenerateTab(buildHooks({ onAutoRevise }));
    document.body.appendChild(ctrl.root);
    ctrl.showResume(INITIAL_MD);
    await flush();

    await openComposer(ctrl.root);
    editRawMarkdown(ctrl.root, SUBMIT_TIME_MD);
    await submitComposer(ctrl.root, 'tighten the resume');

    expect(onAutoRevise).toHaveBeenCalledWith(expect.objectContaining({
      currentMarkdown: SUBMIT_TIME_MD,
      targetScope: { kind: 'whole-resume' },
      instruction: 'tighten the resume',
      model: HAIKU,
    }));

    editRawMarkdown(ctrl.root, LIVE_EDIT_MD);
    pending.resolve(reviseResponse(REVISED_MD));
    await flush();

    ctrl.root.querySelector<HTMLButtonElement>('.revise-diff button[data-action="accept"]')?.click();
    await flush();

    expect(rawTextarea(ctrl.root).value).toBe(LIVE_EDIT_MD);
    expect(ctrl.root.querySelector('.revise-error')?.textContent).toMatch(/resume changed/i);
  });
});
