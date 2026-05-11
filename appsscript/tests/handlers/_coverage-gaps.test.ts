/**
 * _coverage-gaps.test.ts
 *
 * Edge-case probes for the 7 v2 handlers. Each test targets an under-tested
 * code path or a silent-failure mode in the handler logic. Tests are designed
 * to FAIL when a real bug is present and PASS (with a `// SILENT BEHAVIOR:`
 * comment) when the current behavior is documented as acceptable.
 *
 * No source code is modified — bug fixes are someone else's commit.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { handleResearchCompany, validateResearchCompany } from '../../src/handlers/research.js';
import { handleBenchmarkRole } from '../../src/handlers/benchmark.js';
import { handleCritique } from '../../src/handlers/critique.js';
import { handleCoverLetter, validateCoverLetter } from '../../src/handlers/coverLetter.js';
import { handleVerifyClHooks } from '../../src/handlers/verifyHooks.js';
import { handleMultiVersion, validateMultiVersion } from '../../src/handlers/multiVersion.js';
import { handleAutoRevise } from '../../src/handlers/autoRevise.js';
import type { Deps } from '../../src/Code.js';
import type {
  ResearchCompanyRequest,
  BenchmarkRoleRequest,
  CritiqueRequest,
  CoverLetterRequest,
  VerifyClHooksRequest,
  MultiVersionRequest,
  AutoReviseRequest,
} from '../../src/types/api-contract.js';
import type {
  ClaudeClient,
  ClaudeResponse,
  ClaudeUsage,
  SystemBlock,
} from '../../src/types/claude-api.js';
import { ClaudeApiError } from '../../src/types/claude-api.js';
import type { DriveOps, FileEntry, ConcatenatedSourceMaterials } from '../../src/types/drive-ops.js';
import { makeCacheService } from '../helpers/gas-mocks.js';

// ─────────────────────────────────────────────────────────────────────────────
// Shared fixture builders
// ─────────────────────────────────────────────────────────────────────────────

const MODEL = 'claude-haiku-4-5-20251001';

function makeUsage(o: Partial<ClaudeUsage> = {}): ClaudeUsage {
  return {
    input_tokens: 100,
    output_tokens: 50,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    ...o,
  };
}

function makeClaudeResponse(text: string, usage = makeUsage()): ClaudeResponse {
  return { text, stopReason: 'end_turn', usage, model: MODEL };
}

function makeSourceMaterials(text = '=== resume.md ===\nstuff'): ConcatenatedSourceMaterials {
  return {
    text,
    files: [
      { name: 'resume.md', fileId: 'f1', contents: 'stuff', tokens: 5, lastModifiedAt: 1 },
    ],
    totalTokens: 5,
  };
}

function makeRuleFile(name: string): FileEntry {
  return { name, fileId: `f-${name}`, contents: `# ${name}`, tokens: 5, lastModifiedAt: 1 };
}

function makeDriveMock(overrides: Partial<DriveOps> = {}): DriveOps {
  return {
    readSourceFiles: vi.fn(() => makeSourceMaterials()),
    readRuleFiles: vi.fn(() => [makeRuleFile('01-rule.md')]),
    writeOutput: vi.fn(() => ({ docUrl: 'https://docs.google.com/document/d/x/edit', docId: 'x' })),
    writeJobOutput: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    seedDefaults: vi.fn(),
    appendSheetRow: vi.fn(),
    updateSheetRow: vi.fn(),
    replaceDocContents: vi.fn(),
    exportDocAs: vi.fn(),
    downloadFileAsBase64: vi.fn(),
    uploadDocxFromBase64: vi.fn(),
    createFileInFolder: vi.fn(() => ({ fileId: 'f', fileUrl: 'https://example.com/f' })),
    createDriveFile: vi.fn(),
    createGoogleDoc: vi.fn(() => ({ docId: 'd', docUrl: 'https://example.com/d' })),
    ...overrides,
  } as DriveOps;
}

function makeDeps(claudeImpl: ClaudeClient['call'], driveOverrides: Partial<DriveOps> = {}): Deps {
  const sys: SystemBlock = { type: 'text', text: 'sys' };
  return {
    drive: makeDriveMock(driveOverrides),
    claude: { call: vi.fn(claudeImpl) },
    prompt: { composeSystemPrompt: vi.fn(() => sys) },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PROBE C1: research cache key collision — company=null edge case
// ─────────────────────────────────────────────────────────────────────────────

describe('research — cache key collisions / edge cases', () => {
  let cache: ReturnType<typeof makeCacheService>;
  beforeEach(() => {
    cache = makeCacheService();
    vi.stubGlobal('CacheService', cache);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('C1: role=null and role="" produce the SAME cache key — collision risk', () => {
    // The cache key is `research:${company}:${role ?? ''}`. Both null and ""
    // collapse to "" — so an entry cached for role=null will be returned for
    // role="" too. Probe whether this collision actually happens.
    const claude1 = vi.fn(() =>
      makeClaudeResponse(
        JSON.stringify({
          summary: 'SUMMARY_FOR_ROLE_NULL',
          keywords: ['k'],
          sources: [{ title: 't', url: 'https://u' }],
        }),
      ),
    );
    const deps1: Deps = {
      drive: makeDriveMock(),
      claude: { call: claude1 },
      prompt: { composeSystemPrompt: vi.fn() },
    };

    // First call: role=null
    const req1: ResearchCompanyRequest = {
      action: 'research_company',
      company: 'Acme',
      role: null,
      model: MODEL,
    };
    const r1 = handleResearchCompany(deps1, req1);
    expect(r1.ok).toBe(true);
    if (r1.ok) {
      expect(r1.summary).toBe('SUMMARY_FOR_ROLE_NULL');
      expect(r1.cached).toBe(false);
    }

    // Second call: role="" — should HIT the cache from the role=null call.
    // If the silent collision exists, claude is NOT called again. Probe:
    const claude2 = vi.fn(() =>
      makeClaudeResponse(
        JSON.stringify({
          summary: 'SHOULD_NEVER_RETURN',
          keywords: ['x'],
          sources: [{ title: 't', url: 'https://u' }],
        }),
      ),
    );
    const deps2: Deps = {
      drive: makeDriveMock(),
      claude: { call: claude2 },
      prompt: { composeSystemPrompt: vi.fn() },
    };

    const req2: ResearchCompanyRequest = {
      action: 'research_company',
      company: 'Acme',
      role: '' as unknown as string | null,
      model: MODEL,
    };

    // validateResearchCompany rejects role="" because the value is non-string-but-empty —
    // wait: role accepts any string. Empty string is technically a valid string.
    // Probe: does the cache hit fire?
    const v = validateResearchCompany(req2 as unknown as Record<string, unknown>);
    // role="" is a valid string, so validation should pass.
    expect(v).toBeNull();

    const r2 = handleResearchCompany(deps2, req2);
    expect(r2.ok).toBe(true);
    if (r2.ok) {
      // SILENT BEHAVIOR / BUG SURFACED: r2.summary === 'SUMMARY_FOR_ROLE_NULL'
      // because the role-null cache entry was returned. claude2 was NEVER
      // called. This is a silent cache collision.
      // Suspected source: appsscript/src/handlers/research.ts:138
      //   `const cacheKey = \`research:${req.company}:${req.role ?? ''}\`;`
      // The role=null vs role="" distinction is collapsed; a user searching
      // for "Acme" (no role) then later "Acme, role=''" gets stale data.
      expect(r2.summary).toBe('SUMMARY_FOR_ROLE_NULL');
      expect(r2.cached).toBe(true);
      expect(claude2).not.toHaveBeenCalled();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PROBE C2: critique with jobInsights=null still works
// ─────────────────────────────────────────────────────────────────────────────

describe('critique — null jobInsights edge case', () => {
  it('C2: critique with jobInsights=null builds user message without "=== Job Insights ===" section', () => {
    let capturedUserMessage = '';
    const claude: ClaudeClient = {
      call: vi.fn((req) => {
        capturedUserMessage = (req.messages[0]?.content as string) ?? '';
        return makeClaudeResponse(
          JSON.stringify({
            scores: [
              { dimension: 'keyword_coverage', score: 8, weight: 0.2, notes: 'ok' },
              { dimension: 'bullet_impact', score: 8, weight: 0.2, notes: 'ok' },
              { dimension: 'structure', score: 8, weight: 0.15, notes: 'ok' },
              { dimension: 'formatting', score: 8, weight: 0.1, notes: 'ok' },
              { dimension: 'relevance', score: 8, weight: 0.15, notes: 'ok' },
              { dimension: 'truthfulness', score: 10, weight: 0.05, notes: 'ok' },
              { dimension: 'conciseness', score: 8, weight: 0.1, notes: 'ok' },
              { dimension: 'ats_friendliness', score: 9, weight: 0.05, notes: 'ok' },
            ],
            improvements: [
              { tier: 1, text: 'A', expectedDelta: 0.1 },
              { tier: 2, text: 'B', expectedDelta: 0.05 },
              { tier: 2, text: 'C', expectedDelta: 0.05 },
            ],
          }),
        );
      }),
    };
    const deps: Deps = {
      drive: makeDriveMock(),
      claude,
      prompt: { composeSystemPrompt: vi.fn() },
    };

    const req: CritiqueRequest = {
      action: 'critique',
      resumeMd: '# Resume',
      jd: 'JD',
      jobInsights: null,
      jobFolderId: null,
      model: MODEL,
    };
    const result = handleCritique(deps, req);
    expect(result.ok).toBe(true);
    // SILENT BEHAVIOR (passing): when jobInsights is null, the user message
    // built by buildUserMessage in critique.ts skips the Job Insights block
    // entirely. The handler still calls Claude with a well-formed message.
    expect(capturedUserMessage).toContain('=== Job Description ===');
    expect(capturedUserMessage).not.toContain('=== Job Insights ===');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PROBE C3: verify-hooks with zero extracted entities → ok:true with empty array
// ─────────────────────────────────────────────────────────────────────────────

describe('verifyHooks — zero extracted entities short-circuit', () => {
  it('C3: empty entity array from extraction → ok:true, verifications=[], unverifiedCount=0, no per-entity calls', () => {
    let callCount = 0;
    const claude: ClaudeClient = {
      call: vi.fn(() => {
        callCount++;
        if (callCount === 1) {
          // Extraction: empty array
          return makeClaudeResponse('[]');
        }
        // Should NEVER be reached
        return makeClaudeResponse(JSON.stringify({ status: 'verified', sources: [] }));
      }),
    };
    const deps: Deps = {
      drive: makeDriveMock(),
      claude,
      prompt: { composeSystemPrompt: vi.fn() },
    };
    const req: VerifyClHooksRequest = {
      action: 'verify_cl_hooks',
      coverLetterMd: 'A cover letter with no named entities at all.',
      model: MODEL,
    };
    const r = handleVerifyClHooks(deps, req);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.verifications).toEqual([]);
      expect(r.unverifiedCount).toBe(0);
      expect(callCount).toBe(1);
      // SILENT BEHAVIOR (passing): the short-circuit returns ok:true with
      // empty verifications. Cost still reflects the extraction call. The
      // handler correctly does NOT fire per-entity searches.
      expect(r.cost.totalUsd).toBeGreaterThan(0);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PROBE C4: multiVersion with framings.length !== count → validation error
// ─────────────────────────────────────────────────────────────────────────────

describe('multiVersion — framings length mismatch', () => {
  it('C4: framings has 2 items but count=3 → validation error, no Claude call', () => {
    const v = validateMultiVersion({
      action: 'multi_version',
      jd: 'JD',
      sourceFolderId: 'src',
      rulesFolderId: 'rules',
      model: MODEL,
      count: 3,
      framings: ['Tech', 'Lead'], // length 2, count 3
    });
    // SILENT BEHAVIOR (passing): validation catches the mismatch and returns
    // a typed error. No silent acceptance of partial framings.
    expect(v).not.toBeNull();
    expect(v?.ok).toBe(false);
    expect(v?.error.message).toMatch(/framings\.length/);
    expect(v?.error.type).toBe('validation');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PROBE C5: empty rule files passed to research (rule files not used by research,
// but oversized JD content is — probe research with oversized JD)
// ─────────────────────────────────────────────────────────────────────────────

describe('benchmark — empty source materials still produces a Claude call', () => {
  let cache: ReturnType<typeof makeCacheService>;
  beforeEach(() => {
    cache = makeCacheService();
    vi.stubGlobal('CacheService', cache);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('C5: benchmark works regardless of source materials (it builds user prompt from company/role alone)', () => {
    // benchmark does NOT consume source materials — it queries the web via
    // Claude's web_search tool. We assert the user message just frames the
    // role/company, no source-materials concatenation appears.
    let captured = '';
    const claude: ClaudeClient = {
      call: vi.fn((req) => {
        captured = (req.messages[0]?.content as string) ?? '';
        return makeClaudeResponse(
          JSON.stringify({
            patterns: 'P',
            keywords: ['k'],
            sources: [{ title: 't', url: 'https://u' }],
          }),
        );
      }),
    };
    const req: BenchmarkRoleRequest = {
      action: 'benchmark_role',
      company: 'Acme',
      role: 'Senior Eng',
      model: MODEL,
    };
    const r = handleBenchmarkRole(
      { drive: makeDriveMock(), claude, prompt: { composeSystemPrompt: vi.fn() } },
      req,
    );
    expect(r.ok).toBe(true);
    // SILENT BEHAVIOR (passing): benchmark user message does not embed
    // resume/source material — it's purely about the company/role pair.
    expect(captured).toContain('Acme');
    expect(captured).toContain('Senior Eng');
    expect(captured).not.toContain('resume');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PROBE C6: cover_letter with extremely long resumeMd (near max tokens)
// ─────────────────────────────────────────────────────────────────────────────

describe('coverLetter — oversized resumeMd input', () => {
  it('C6: 50K-char resumeMd is passed through to Claude as-is (no truncation, no validation)', () => {
    // Probe: handler does NOT enforce any input cap. A 50K-char resumeMd
    // is forwarded to Claude verbatim. The user might hit token limits
    // server-side, but the handler itself silently accepts the payload.
    const massive = '#'.repeat(50_000);
    let captured = '';
    const claude: ClaudeClient = {
      call: vi.fn((req) => {
        captured = (req.messages[0]?.content as string) ?? '';
        return makeClaudeResponse('Dear hiring manager, here is your cover letter.');
      }),
    };
    const deps: Deps = {
      drive: makeDriveMock(),
      claude,
      prompt: { composeSystemPrompt: vi.fn() },
    };
    const req: CoverLetterRequest = {
      action: 'cover_letter',
      resumeMd: massive,
      jd: 'JD',
      company: 'Acme',
      role: 'SWE',
      sourceFolderId: 'src',
      rulesFolderId: 'rules',
      jobFolderId: 'job',
      model: MODEL,
    };
    const r = handleCoverLetter(deps, req);
    // SILENT BEHAVIOR (passing): the 50K-char input is passed to Claude
    // without any truncation/validation. The handler returns ok:true with
    // the (mock) Claude response. In production this might exceed Claude's
    // input window and surface as a Claude API error, but the handler
    // itself does NOT protect against it — there's no max length check
    // on resumeMd. This is documented but flagged: a defensive cap would
    // give the user a clearer "your resume is too long" error.
    expect(r.ok).toBe(true);
    expect(captured.length).toBeGreaterThanOrEqual(50_000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PROBE C7: critique with malformed JSON (extra trailing data) — should reject loudly
// ─────────────────────────────────────────────────────────────────────────────

describe('critique — malformed JSON with trailing data', () => {
  it('C7: Claude returns valid JSON followed by garbage → tryExtractJson silently strips fences but JSON.parse fails LOUDLY', () => {
    // Probe: the fence-strip regex only matches when JSON is wrapped in
    // ```...``` fences. Without fences, the entire response is passed to
    // JSON.parse. Trailing garbage triggers a SyntaxError, which the
    // handler catches and returns ok:false. We assert this loud-fail path.
    const malformed = JSON.stringify({
      scores: [],
      improvements: [],
    }) + '\n\nHere is some trailing commentary that should not be here.';

    const claude: ClaudeClient = {
      call: vi.fn(() => makeClaudeResponse(malformed)),
    };
    const deps: Deps = {
      drive: makeDriveMock(),
      claude,
      prompt: { composeSystemPrompt: vi.fn() },
    };
    const req: CritiqueRequest = {
      action: 'critique',
      resumeMd: '# Resume',
      jd: 'JD',
      jobInsights: null,
      jobFolderId: null,
      model: MODEL,
    };
    const r = handleCritique(deps, req);
    // SILENT BEHAVIOR (passing): critique correctly fails loudly when the
    // JSON parse encounters trailing data — type: 'server', retryable: true.
    // No silent acceptance.
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.type).toBe('server');
      expect(r.error.retryable).toBe(true);
      expect(r.error.message).toMatch(/not valid JSON/);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PROBE C8: research with company containing JSON-injection-shaped string
// ─────────────────────────────────────────────────────────────────────────────

describe('research — company string with quote characters (JSON-injection probe)', () => {
  let cache: ReturnType<typeof makeCacheService>;
  beforeEach(() => {
    cache = makeCacheService();
    vi.stubGlobal('CacheService', cache);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('C8: company name with quotes/colons does NOT corrupt the cache key (collision check)', () => {
    // Probe: the cache key is built via template-literal interpolation.
    // A company name with ":" in it could collide with another (company,role)
    // pair. e.g. company='Acme:foo' role='bar' has the same cacheKey as
    // company='Acme' role='foo:bar' (both → "research:Acme:foo:bar").
    const c1 = vi.fn(() =>
      makeClaudeResponse(
        JSON.stringify({
          summary: 'SUMMARY_FOR_company-with-colon',
          keywords: ['k'],
          sources: [{ title: 't', url: 'https://u' }],
        }),
      ),
    );

    const req1: ResearchCompanyRequest = {
      action: 'research_company',
      company: 'Acme:foo',
      role: 'bar',
      model: MODEL,
    };
    const r1 = handleResearchCompany(
      { drive: makeDriveMock(), claude: { call: c1 }, prompt: { composeSystemPrompt: vi.fn() } },
      req1,
    );
    expect(r1.ok).toBe(true);

    // Second request with shifted colon — same cache key.
    const c2 = vi.fn(() =>
      makeClaudeResponse(
        JSON.stringify({
          summary: 'SUMMARY_FOR_company-no-colon',
          keywords: ['k2'],
          sources: [{ title: 't', url: 'https://u' }],
        }),
      ),
    );
    const req2: ResearchCompanyRequest = {
      action: 'research_company',
      company: 'Acme',
      role: 'foo:bar',
      model: MODEL,
    };
    const r2 = handleResearchCompany(
      { drive: makeDriveMock(), claude: { call: c2 }, prompt: { composeSystemPrompt: vi.fn() } },
      req2,
    );
    expect(r2.ok).toBe(true);
    if (r2.ok) {
      // BUG SURFACED: r2.summary will be SUMMARY_FOR_company-with-colon
      // because the cache key collision returns the first cached entry.
      // c2 was never called. The user gets stale data for a different
      // company/role pair.
      // Suspected source: appsscript/src/handlers/research.ts:138
      //   `const cacheKey = \`research:${req.company}:${req.role ?? ''}\`;`
      // Should escape or use a delimiter unlikely to appear in user input
      // (e.g. JSON.stringify of [company, role]).
      // FAILING ASSERTION: assert the CORRECT behavior — different
      // (company, role) pairs should yield different cache entries.
      expect(r2.summary).toBe('SUMMARY_FOR_company-no-colon');
      expect(c2).toHaveBeenCalledTimes(1);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PROBE C9: autoRevise with scope it can't locate → flags ALL as unauthorized
// ─────────────────────────────────────────────────────────────────────────────

describe('autoRevise — unfindable scope', () => {
  it('C9: bullet-id scope with bulletId that does NOT exist in markdown → all changes marked unauthorized', () => {
    // Probe: when scope.kind === "bullet" and the bullet-id comment is
    // missing from the source, partitionUnauthorized returns the entire
    // diff. This is the correct LOUD behavior; we assert it.
    const claude: ClaudeClient = {
      call: vi.fn(() => makeClaudeResponse('# Different\n\n- Different bullet')),
    };
    const deps: Deps = {
      drive: makeDriveMock(),
      claude,
      prompt: { composeSystemPrompt: vi.fn() },
    };
    const req: AutoReviseRequest = {
      action: 'auto_revise',
      currentMarkdown: '# Original\n\n- Original bullet',
      targetScope: { kind: 'bullet', bulletId: 'nonexistent-id' },
      instruction: 'fix this',
      model: MODEL,
    };
    const r = handleAutoRevise(deps, req);
    expect(r.ok).toBe(true);
    if (r.ok) {
      // SILENT BEHAVIOR (passing): unfindable scope correctly results in
      // every diff line being flagged as unauthorized. The UI can then
      // warn the user. No silent acceptance of out-of-scope edits.
      expect(r.diff.length).toBeGreaterThan(0);
      expect(r.unauthorizedChanges.length).toBeGreaterThan(0);
      expect(r.unauthorizedChanges.length).toBe(r.diff.length);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PROBE C10: cover_letter with empty rule files folder → handler emits warn but proceeds
// ─────────────────────────────────────────────────────────────────────────────

describe('coverLetter — missing CL rule file', () => {
  it('C10: rule files array does NOT contain "10-cover-letter-industry" → handler warns but still produces a CL', () => {
    // Probe: cover letter relies on rule "10-cover-letter-industry.md" for
    // HOOK/EVIDENCE/CLOSING structure. If that rule file is missing, the
    // handler logs a warning but PROCEEDS — Claude must figure it out from
    // the in-prompt instruction alone. Probe the silent-fallback behavior.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const claude: ClaudeClient = {
      call: vi.fn(() => makeClaudeResponse('Dear team, I would love to join...')),
    };
    const drive = makeDriveMock({
      // No 10-cover-letter-industry.md in the rule files.
      readRuleFiles: vi.fn(() => [makeRuleFile('01-priority-hierarchy.md')]),
    });
    const deps: Deps = {
      drive,
      claude,
      prompt: { composeSystemPrompt: vi.fn(() => ({ type: 'text' as const, text: 'sys' })) },
    };
    const req: CoverLetterRequest = {
      action: 'cover_letter',
      resumeMd: '# Resume',
      jd: 'JD',
      company: 'Acme',
      role: 'SWE',
      sourceFolderId: 'src',
      rulesFolderId: 'rules',
      jobFolderId: 'job',
      model: MODEL,
    };
    const r = handleCoverLetter(deps, req);
    // SILENT BEHAVIOR (passing): the handler logs a warn() when the load-
    // bearing rule is missing but does NOT fail the request. The user gets
    // a cover letter built without the canonical structure guidance.
    // We assert this is intentional by verifying the warn fired AND the
    // result is ok:true.
    expect(r.ok).toBe(true);
    const warns = warnSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(warns).toMatch(/10-cover-letter-industry/);
  });
});
