import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createRegistry,
  type StateStore,
  type JobHelpStateMinimal,
  type StateError,
} from '../../core/resumes/registry.js';
import { ok, err, isOk, type Result } from '../../core/types/result.js';

function makeMockStateStore(initial: JobHelpStateMinimal): {
  store: StateStore;
  current: () => JobHelpStateMinimal;
  readCalls: () => number;
  writeCalls: () => number;
  failNextRead: () => void;
  failNextWrite: () => void;
} {
  let state: JobHelpStateMinimal = initial;
  let reads = 0;
  let writes = 0;
  let nextReadFails = false;
  let nextWriteFails = false;

  const store: StateStore = {
    read: async (): Promise<Result<JobHelpStateMinimal, StateError>> => {
      reads += 1;
      if (nextReadFails) {
        nextReadFails = false;
        return err<StateError>({ type: 'io', message: 'mock read fail' });
      }
      return ok(state);
    },
    write: async (
      patch: (s: JobHelpStateMinimal) => JobHelpStateMinimal,
    ): Promise<Result<void, StateError>> => {
      writes += 1;
      if (nextWriteFails) {
        nextWriteFails = false;
        return err<StateError>({ type: 'io', message: 'mock write fail' });
      }
      state = patch(state);
      return ok(undefined);
    },
  };

  return {
    store,
    current: () => state,
    readCalls: () => reads,
    writeCalls: () => writes,
    failNextRead: () => {
      nextReadFails = true;
    },
    failNextWrite: () => {
      nextWriteFails = true;
    },
  };
}

const EMPTY_STATE: JobHelpStateMinimal = { resumes: {}, activeResumeName: null };

describe('createRegistry — registerResume', () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'jobhelp-resumes-'));
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('writes markdown to {dir}/{name}.md and records in state', async () => {
    const mock = makeMockStateStore(EMPTY_STATE);
    const reg = createRegistry({ store: mock.store, resumesDir: tmp });
    const result = await reg.registerResume({ name: 'backend', content: '# My Backend Resume' });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    const written = await readFile(join(tmp, 'backend.md'), 'utf8');
    expect(written).toBe('# My Backend Resume');
    const s = mock.current();
    expect(s.resumes['backend']).toBeDefined();
    expect(s.resumes['backend']?.path).toBe(join(tmp, 'backend.md'));
  });

  it('makes the first registered resume the active one', async () => {
    const mock = makeMockStateStore(EMPTY_STATE);
    const reg = createRegistry({ store: mock.store, resumesDir: tmp });
    await reg.registerResume({ name: 'backend', content: '# Backend' });
    expect(mock.current().activeResumeName).toBe('backend');
  });

  it('does NOT change active when registering a second resume', async () => {
    const mock = makeMockStateStore(EMPTY_STATE);
    const reg = createRegistry({ store: mock.store, resumesDir: tmp });
    await reg.registerResume({ name: 'backend', content: '# Backend' });
    await reg.registerResume({ name: 'frontend', content: '# Frontend' });
    expect(mock.current().activeResumeName).toBe('backend');
  });

  it('overwrites file and updates state when re-registering same name', async () => {
    const mock = makeMockStateStore(EMPTY_STATE);
    const reg = createRegistry({ store: mock.store, resumesDir: tmp });
    await reg.registerResume({ name: 'backend', content: '# v1' });
    await reg.registerResume({ name: 'backend', content: '# v2' });
    const written = await readFile(join(tmp, 'backend.md'), 'utf8');
    expect(written).toBe('# v2');
    expect(Object.keys(mock.current().resumes)).toEqual(['backend']);
  });

  it('rejects invalid names (path separators, dotfiles)', async () => {
    const mock = makeMockStateStore(EMPTY_STATE);
    const reg = createRegistry({ store: mock.store, resumesDir: tmp });
    for (const bad of ['../escape', 'a/b', '.hidden', '', '   ', 'name.md']) {
      const r = await reg.registerResume({ name: bad, content: '# x' });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error.type).toBe('invalid_name');
      }
    }
  });

  it('rejects empty content', async () => {
    const mock = makeMockStateStore(EMPTY_STATE);
    const reg = createRegistry({ store: mock.store, resumesDir: tmp });
    const r = await reg.registerResume({ name: 'backend', content: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.type).toBe('invalid_content');
  });

  it('returns io error when state write fails', async () => {
    const mock = makeMockStateStore(EMPTY_STATE);
    const reg = createRegistry({ store: mock.store, resumesDir: tmp });
    mock.failNextWrite();
    const r = await reg.registerResume({ name: 'backend', content: '# Backend' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.type).toBe('io');
  });
});

describe('createRegistry — setActiveResume', () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'jobhelp-resumes-'));
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('switches active to a registered name', async () => {
    const mock = makeMockStateStore(EMPTY_STATE);
    const reg = createRegistry({ store: mock.store, resumesDir: tmp });
    await reg.registerResume({ name: 'backend', content: '# B' });
    await reg.registerResume({ name: 'frontend', content: '# F' });
    const r = await reg.setActiveResume({ name: 'frontend' });
    expect(isOk(r)).toBe(true);
    expect(mock.current().activeResumeName).toBe('frontend');
  });

  it('returns not_found if name is not registered', async () => {
    const mock = makeMockStateStore(EMPTY_STATE);
    const reg = createRegistry({ store: mock.store, resumesDir: tmp });
    const r = await reg.setActiveResume({ name: 'ghost' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.type).toBe('not_found');
  });
});

describe('createRegistry — readResume', () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'jobhelp-resumes-'));
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('reads named resume content from disk', async () => {
    const mock = makeMockStateStore(EMPTY_STATE);
    const reg = createRegistry({ store: mock.store, resumesDir: tmp });
    await reg.registerResume({ name: 'backend', content: '# Backend body' });
    const r = await reg.readResume({ name: 'backend' });
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    expect(r.value).toBe('# Backend body');
  });

  it('defaults to active resume when name omitted', async () => {
    const mock = makeMockStateStore(EMPTY_STATE);
    const reg = createRegistry({ store: mock.store, resumesDir: tmp });
    await reg.registerResume({ name: 'backend', content: '# Active' });
    const r = await reg.readResume({});
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    expect(r.value).toBe('# Active');
  });

  it('returns no_active when name omitted and no active set', async () => {
    const mock = makeMockStateStore(EMPTY_STATE);
    const reg = createRegistry({ store: mock.store, resumesDir: tmp });
    const r = await reg.readResume({});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.type).toBe('no_active');
  });

  it('returns not_found for unknown name', async () => {
    const mock = makeMockStateStore(EMPTY_STATE);
    const reg = createRegistry({ store: mock.store, resumesDir: tmp });
    const r = await reg.readResume({ name: 'ghost' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.type).toBe('not_found');
  });
});

describe('createRegistry — listResumes', () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'jobhelp-resumes-'));
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('returns empty list for fresh state', async () => {
    const mock = makeMockStateStore(EMPTY_STATE);
    const reg = createRegistry({ store: mock.store, resumesDir: tmp });
    const r = await reg.listResumes();
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    expect(r.value.length).toBe(0);
  });

  it('lists all registered resumes with path, size, modifiedAt', async () => {
    const mock = makeMockStateStore(EMPTY_STATE);
    const reg = createRegistry({ store: mock.store, resumesDir: tmp });
    await reg.registerResume({ name: 'backend', content: '# B' });
    await reg.registerResume({ name: 'frontend', content: '# Frontend longer' });
    const r = await reg.listResumes();
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    expect(r.value.length).toBe(2);
    const backend = r.value.find((x) => x.name === 'backend');
    const frontend = r.value.find((x) => x.name === 'frontend');
    expect(backend?.path).toBe(join(tmp, 'backend.md'));
    expect(backend?.size).toBeGreaterThan(0);
    expect(typeof backend?.modifiedAt).toBe('string');
    expect(frontend?.size).toBeGreaterThan(backend?.size ?? 0);
  });
});
