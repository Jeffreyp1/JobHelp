/**
 * @file tests/contracts/v2-features.contract.test.ts
 *
 * BLACK-BOX contract tests for the v2 feature actions:
 *   - research_company
 *   - benchmark_role
 *   - critique
 *   - auto_revise
 *   - cover_letter
 *   - verify_cl_hooks
 *   - multi_version
 *
 * For each action, three contract invariants are probed:
 *   1. Happy-path response matches the typed Result interface.
 *   2. Missing a required field produces a typed ApiErrorResponse.
 *   3. The response is JSON-serializable (no functions, no circular refs).
 *
 * Plus action-specific shape checks (e.g. verifications is always an array,
 * multi_version variants.length === request.count).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { doPost } from '../../appsscript/src/Code.js';
import type { DriveOps } from '../../appsscript/src/types/drive-ops.js';
import type {
  ClaudeClient,
  ClaudeResponse,
} from '../../appsscript/src/types/claude-api.js';
import {
  JOB_FOLDER_ID,
  MODEL,
  RULES_FOLDER_ID,
  SHEET_ID,
  SOURCE_FOLDER_ID,
  assertJsonSerializable,
  installCacheServiceStub,
  isApiError,
  isObject,
  makeClaudeMock,
  makeClaudeResponse,
  makeDriveMock,
  makeEvent,
  makePromptMock,
  parseOutput,
} from './_setup.js';

// ─────────────────────────────────────────────────────────────────────────────
// Per-handler Claude response shapes — overridden via makeClaudeMock for each
// happy-path test so the handler's internal JSON parse succeeds.
// ─────────────────────────────────────────────────────────────────────────────

function researchClaudeResponse(): ClaudeResponse {
  return {
    ...makeClaudeResponse(),
    text: JSON.stringify({
      summary: 'Acme is a fictional widget company.',
      keywords: ['widgets', 'manufacturing', 'ohio'],
      sources: [{ title: 'Acme Co. site', url: 'https://acme.example.com' }],
    }),
  };
}

function benchmarkClaudeResponse(): ClaudeResponse {
  return {
    ...makeClaudeResponse(),
    text: JSON.stringify({
      patterns:
        'Successful candidates have 5+ years building distributed systems and Python.',
      keywords: ['distributed', 'python', 'kubernetes'],
      sources: [
        { title: 'LinkedIn profile', url: 'https://linkedin.com/in/example' },
      ],
    }),
  };
}

function critiqueClaudeResponse(): ClaudeResponse {
  return {
    ...makeClaudeResponse(),
    text: JSON.stringify({
      scores: [
        { dimension: 'keyword_coverage', score: 8, weight: 0.2, notes: 'good' },
        { dimension: 'bullet_impact', score: 7, weight: 0.2, notes: 'ok' },
      ],
      improvements: [
        { tier: 1, text: 'Quantify the third bullet', expectedDelta: 0.5 },
        { tier: 2, text: 'Tighten the summary paragraph', expectedDelta: 0.3 },
      ],
    }),
  };
}

function autoReviseClaudeResponse(original: string): ClaudeResponse {
  return {
    ...makeClaudeResponse(),
    text: original, // byte-identical → no diff entries
  };
}

function coverLetterClaudeResponse(): ClaudeResponse {
  return {
    ...makeClaudeResponse(),
    text: 'Dear hiring manager,\n\nI am excited to apply...\n\nSincerely,\nMe',
  };
}

function verifyExtractionResponse(): ClaudeResponse {
  return {
    ...makeClaudeResponse(),
    // verifyHooks STEP 1 is a JSON array of {entity, entityType}
    text: JSON.stringify([
      { entity: 'Acme Corp', entityType: 'company' },
      { entity: 'WidgetOS', entityType: 'product' },
    ]),
  };
}

function verifyPerEntityResponse(): ClaudeResponse {
  return {
    ...makeClaudeResponse(),
    text: JSON.stringify({
      status: 'verified',
      sources: [{ title: 'Acme Co. site', url: 'https://acme.example.com' }],
    }),
  };
}

function multiVersionVariantResponse(label: string): ClaudeResponse {
  return {
    ...makeClaudeResponse(),
    text: `# Resume variant: ${label}\n\nContent…`,
  };
}

// Common AUTOREVISE fixture markdown with a bullet-id sentinel so the
// scope-resolver can locate the in-scope range.
const AUTOREVISE_INPUT = [
  '# Resume',
  '',
  '## Experience',
  '',
  '### Acme — Engineer (2020-2024)',
  '<!-- bullet-id: b1 -->',
  '- Built distributed widget factory',
  '<!-- bullet-id: b2 -->',
  '- Maintained Python services',
].join('\n');

// ─────────────────────────────────────────────────────────────────────────────

interface ContractCase {
  name: string;
  action: string;
  /** Full happy-path payload. */
  happy: Record<string, unknown>;
  /** One field whose omission should yield a typed validation error. */
  requiredField: string;
  /** Build Claude / Drive / prompt mocks tuned to the handler. */
  makeDeps: () => { drive: DriveOps; claude: ClaudeClient; prompt: ReturnType<typeof makePromptMock> };
  /** Assertions specific to the happy-path Result shape. */
  assertHappy: (body: Record<string, unknown>) => void;
}

// ─── research_company ────────────────────────────────────────────────────────

const researchCase: ContractCase = {
  name: 'research_company',
  action: 'research_company',
  happy: {
    action: 'research_company',
    company: 'Acme',
    role: 'Senior Engineer',
    model: MODEL,
  },
  requiredField: 'company',
  makeDeps: () => ({
    drive: makeDriveMock(),
    claude: makeClaudeMock({ call: vi.fn(() => researchClaudeResponse()) }),
    prompt: makePromptMock(),
  }),
  assertHappy: (body) => {
    expect(typeof body.summary).toBe('string');
    expect(Array.isArray(body.keywords)).toBe(true);
    expect(Array.isArray(body.sources)).toBe(true);
    expect(typeof body.cached).toBe('boolean');
    expect(isObject(body.cost)).toBe(true);
    // each source has { title, url } strings
    for (const src of body.sources as Array<Record<string, unknown>>) {
      expect(typeof src.title).toBe('string');
      expect(typeof src.url).toBe('string');
    }
  },
};

// ─── benchmark_role ──────────────────────────────────────────────────────────

const benchmarkCase: ContractCase = {
  name: 'benchmark_role',
  action: 'benchmark_role',
  happy: {
    action: 'benchmark_role',
    company: 'Acme',
    role: 'Senior Engineer',
    model: MODEL,
  },
  requiredField: 'role',
  makeDeps: () => ({
    drive: makeDriveMock(),
    claude: makeClaudeMock({ call: vi.fn(() => benchmarkClaudeResponse()) }),
    prompt: makePromptMock(),
  }),
  assertHappy: (body) => {
    expect(typeof body.patterns).toBe('string');
    expect(Array.isArray(body.keywords)).toBe(true);
    expect(Array.isArray(body.sources)).toBe(true);
    expect(typeof body.cached).toBe('boolean');
    expect(isObject(body.cost)).toBe(true);
  },
};

// ─── critique ────────────────────────────────────────────────────────────────

const critiqueCase: ContractCase = {
  name: 'critique',
  action: 'critique',
  happy: {
    action: 'critique',
    resumeMd: '# Resume\n\nSome content.',
    jd: 'Looking for a Python developer.',
    jobInsights: null,
    jobFolderId: null,
    model: MODEL,
  },
  requiredField: 'resumeMd',
  makeDeps: () => ({
    drive: makeDriveMock(),
    claude: makeClaudeMock({ call: vi.fn(() => critiqueClaudeResponse()) }),
    prompt: makePromptMock(),
  }),
  assertHappy: (body) => {
    expect(Array.isArray(body.scores)).toBe(true);
    expect(Array.isArray(body.improvements)).toBe(true);
    expect(typeof body.totalScore).toBe('number');
    expect(isObject(body.cost)).toBe(true);
    // critiqueDocUrl is `string | null` — never undefined.
    expect(body.critiqueDocUrl === null || typeof body.critiqueDocUrl === 'string').toBe(true);
    expect('critiqueDocUrl' in body).toBe(true);
  },
};

// ─── auto_revise ─────────────────────────────────────────────────────────────

const autoReviseCase: ContractCase = {
  name: 'auto_revise',
  action: 'auto_revise',
  happy: {
    action: 'auto_revise',
    currentMarkdown: AUTOREVISE_INPUT,
    targetScope: { kind: 'whole-resume' },
    instruction: 'Polish the resume',
    model: MODEL,
  },
  requiredField: 'currentMarkdown',
  makeDeps: () => ({
    drive: makeDriveMock(),
    claude: makeClaudeMock({
      call: vi.fn(() => autoReviseClaudeResponse(AUTOREVISE_INPUT)),
    }),
    prompt: makePromptMock(),
  }),
  assertHappy: (body) => {
    expect(typeof body.revisedMarkdown).toBe('string');
    expect(Array.isArray(body.diff)).toBe(true);
    expect(Array.isArray(body.unauthorizedChanges)).toBe(true);
    expect(isObject(body.cost)).toBe(true);
  },
};

// ─── cover_letter ────────────────────────────────────────────────────────────

const coverLetterCase: ContractCase = {
  name: 'cover_letter',
  action: 'cover_letter',
  happy: {
    action: 'cover_letter',
    resumeMd: '# Resume',
    jd: 'JD',
    company: 'Acme',
    role: 'Engineer',
    sourceFolderId: SOURCE_FOLDER_ID,
    rulesFolderId: RULES_FOLDER_ID,
    jobFolderId: JOB_FOLDER_ID,
    model: MODEL,
  },
  requiredField: 'resumeMd',
  makeDeps: () => ({
    drive: makeDriveMock(),
    claude: makeClaudeMock({ call: vi.fn(() => coverLetterClaudeResponse()) }),
    prompt: makePromptMock(),
  }),
  assertHappy: (body) => {
    expect(typeof body.coverLetterMd).toBe('string');
    expect(typeof body.docUrl).toBe('string');
    expect(typeof body.mdFileUrl).toBe('string');
    expect(isObject(body.cost)).toBe(true);
  },
};

// ─── verify_cl_hooks ─────────────────────────────────────────────────────────

const verifyHooksCase: ContractCase = {
  name: 'verify_cl_hooks',
  action: 'verify_cl_hooks',
  happy: {
    action: 'verify_cl_hooks',
    coverLetterMd:
      'Dear Acme — your WidgetOS platform led me to apply. Sincerely, Me.',
    model: MODEL,
  },
  requiredField: 'coverLetterMd',
  makeDeps: () => {
    // The handler issues 1 extraction call + N per-entity calls. We script
    // the mock to return the extraction shape on first call and the
    // per-entity shape on subsequent ones.
    let callIndex = 0;
    const calls = [verifyExtractionResponse, verifyPerEntityResponse, verifyPerEntityResponse];
    return {
      drive: makeDriveMock(),
      claude: makeClaudeMock({
        call: vi.fn(() => {
          const builder = calls[Math.min(callIndex, calls.length - 1)];
          callIndex += 1;
          return builder();
        }),
      }),
      prompt: makePromptMock(),
    };
  },
  assertHappy: (body) => {
    expect(Array.isArray(body.verifications)).toBe(true);
    expect(typeof body.unverifiedCount).toBe('number');
    expect(isObject(body.cost)).toBe(true);
  },
};

// ─── multi_version ───────────────────────────────────────────────────────────

const multiVersionCase: ContractCase = {
  name: 'multi_version',
  action: 'multi_version',
  happy: {
    action: 'multi_version',
    jd: 'JD',
    company: 'Acme',
    role: 'Engineer',
    jobInsights: null,
    sourceFolderId: SOURCE_FOLDER_ID,
    rulesFolderId: RULES_FOLDER_ID,
    model: MODEL,
    count: 3,
  },
  requiredField: 'jd',
  makeDeps: () => {
    let i = 0;
    const labels = ['Technical depth', 'Leadership', 'Business outcomes'];
    return {
      drive: makeDriveMock(),
      claude: makeClaudeMock({
        call: vi.fn(() => {
          const label = labels[Math.min(i, labels.length - 1)];
          i += 1;
          return multiVersionVariantResponse(label);
        }),
      }),
      prompt: makePromptMock(),
    };
  },
  assertHappy: (body) => {
    expect(Array.isArray(body.variants)).toBe(true);
    expect(isObject(body.cost)).toBe(true);
    for (const v of body.variants as Array<Record<string, unknown>>) {
      expect(typeof v.label).toBe('string');
      expect(typeof v.framing).toBe('string');
      expect(typeof v.markdown).toBe('string');
    }
  },
};

const CASES: ContractCase[] = [
  researchCase,
  benchmarkCase,
  critiqueCase,
  autoReviseCase,
  coverLetterCase,
  verifyHooksCase,
  multiVersionCase,
];

describe('contract: v2 feature actions', () => {
  beforeEach(() => {
    installCacheServiceStub();
  });

  describe.each(CASES)('action="$name"', (c) => {
    // ── 1. Happy-path response shape ──────────────────────────────────────
    it(`${c.name}: happy-path matches typed Result shape`, () => {
      const deps = c.makeDeps();
      const out = doPost(makeEvent(c.happy), deps);
      const body = parseOutput(out);

      if (!isObject(body)) throw new Error('response not an object');
      if (body.ok !== true) {
        throw new Error(
          `expected ok:true; got ${JSON.stringify(body).slice(0, 300)}`,
        );
      }
      c.assertHappy(body);
    });

    // ── 2. Missing required field surfaces typed validation error ─────────
    it(`${c.name}: missing required field "${c.requiredField}" yields validation error`, () => {
      const deps = c.makeDeps();
      const payload: Record<string, unknown> = { ...c.happy };
      delete payload[c.requiredField];

      const out = doPost(makeEvent(payload), deps);
      const body = parseOutput(out);
      expect(isApiError(body)).toBe(true);
      if (!isApiError(body)) return;
      expect(body.error.type).toBe('validation');
      expect(body.error.retryable).toBe(false);
    });

    // ── 3. JSON serializability (no functions, no circular refs, ok bool) ─
    it(`${c.name}: response is JSON-serializable and response.ok is boolean`, () => {
      const deps = c.makeDeps();
      const out = doPost(makeEvent(c.happy), deps);
      const body = parseOutput(out);
      assertJsonSerializable(body);
      if (!isObject(body)) throw new Error('response not an object');
      expect(typeof body.ok).toBe('boolean');
      expect(body.ok).not.toBeUndefined();
    });
  });

  // ── action-specific deeper shape probes ────────────────────────────────────

  it('verify_cl_hooks: verifications is always an array (even when 0 entities)', () => {
    // Force extraction to return [] so the short-circuit path is exercised.
    const claude = makeClaudeMock({
      call: vi.fn(
        (): ClaudeResponse => ({
          ...makeClaudeResponse(),
          text: '[]',
        }),
      ),
    });
    const out = doPost(
      makeEvent({
        action: 'verify_cl_hooks',
        coverLetterMd: 'Hello world.',
        model: MODEL,
      }),
      { drive: makeDriveMock(), claude, prompt: makePromptMock() },
    );
    const body = parseOutput(out);
    if (!isObject(body) || body.ok !== true) {
      throw new Error(`expected ok:true; got ${JSON.stringify(body)}`);
    }
    expect(Array.isArray(body.verifications)).toBe(true);
    expect((body.verifications as unknown[]).length).toBe(0);
    expect(body.unverifiedCount).toBe(0);
  });

  it('multi_version: with count=3, variants.length === 3', () => {
    const deps = multiVersionCase.makeDeps();
    const out = doPost(
      makeEvent({ ...multiVersionCase.happy, count: 3 }),
      deps,
    );
    const body = parseOutput(out);
    if (!isObject(body) || body.ok !== true) {
      throw new Error(`expected ok:true; got ${JSON.stringify(body)}`);
    }
    expect(Array.isArray(body.variants)).toBe(true);
    expect((body.variants as unknown[]).length).toBe(3);
  });
});
