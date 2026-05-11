/**
 * Tests for appsscript/src/handlers/multiVersion.ts
 *
 * Tests use full dependency injection: drive, claude, and prompt are mocked.
 * No GAS globals are touched.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleMultiVersion, validateMultiVersion, accumulateCost } from '../../src/handlers/multiVersion.js';
import type { Deps } from '../../src/Code.js';
import type { MultiVersionRequest } from '../../src/types/api-contract.js';
import type { ClaudeResponse, ClaudeClient } from '../../src/types/claude-api.js';
import type { ConcatenatedSourceMaterials, FileEntry } from '../../src/types/drive-ops.js';
import type { SystemBlock } from '../../src/types/claude-api.js';

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

const SOURCE_FOLDER_ID = 'source-folder-id';
const RULES_FOLDER_ID = 'rules-folder-id';
const MODEL = 'claude-haiku-4-5-20251001';

function makeSourceMaterials(): ConcatenatedSourceMaterials {
  return {
    text: '=== resume.md ===\nI am a software engineer with 5 years of experience.',
    files: [
      {
        name: 'resume.md',
        fileId: 'file-resume',
        contents: 'I am a software engineer with 5 years of experience.',
        tokens: 12,
        lastModifiedAt: 1_700_000_000_000,
      },
    ],
    totalTokens: 12,
  };
}

function makeRuleFile(name: string): FileEntry {
  return {
    name,
    fileId: `file-${name}`,
    contents: `# ${name}\nrule content`,
    tokens: 10,
    lastModifiedAt: 1_700_000_000_000,
    loadBearing: false,
  };
}

function makeClaudeResponse(text: string, inputTokens = 500, outputTokens = 800): ClaudeResponse {
  return {
    text,
    stopReason: 'end_turn',
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
    model: MODEL,
  };
}

function makeSystemBlock(text = 'You are a resume writer.'): SystemBlock {
  return { type: 'text', text };
}

function makeBaseRequest(overrides: Partial<MultiVersionRequest> = {}): MultiVersionRequest {
  return {
    action: 'multi_version',
    jd: 'We are looking for a Senior Software Engineer.',
    company: 'Acme Corp',
    role: 'Senior Software Engineer',
    jobInsights: null,
    sourceFolderId: SOURCE_FOLDER_ID,
    rulesFolderId: RULES_FOLDER_ID,
    model: MODEL,
    count: 3,
    ...overrides,
  };
}

function makeDeps(
  claudeImpl: ClaudeClient['call'] = () => makeClaudeResponse('# Resume\n\n## Experience\n- Built things'),
  sourceOverride?: () => ConcatenatedSourceMaterials,
): Deps {
  const readSourceFiles = sourceOverride ?? (() => makeSourceMaterials());
  const readRuleFiles = () => [makeRuleFile('01-priority-hierarchy.md')];
  const composeSystemPrompt = () => makeSystemBlock();

  return {
    drive: {
      readSourceFiles: vi.fn(readSourceFiles),
      readRuleFiles: vi.fn(readRuleFiles),
      writeOutput: vi.fn(),
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
    } as unknown as Deps['drive'],
    claude: { call: vi.fn(claudeImpl) },
    prompt: { composeSystemPrompt: vi.fn(composeSystemPrompt) },
  };
}

// ---------------------------------------------------------------------------
// validateMultiVersion
// ---------------------------------------------------------------------------

describe('validateMultiVersion', () => {
  it('T5: missing jd → validation error', () => {
    const raw = { sourceFolderId: 'x', rulesFolderId: 'y', model: 'm', count: 2 };
    const result = validateMultiVersion(raw);
    expect(result).not.toBeNull();
    expect(result?.ok).toBe(false);
    expect(result?.error.type).toBe('validation');
    expect(result?.error.message).toMatch(/jd/);
  });

  it('missing sourceFolderId → validation error', () => {
    const raw = { jd: 'job desc', rulesFolderId: 'y', model: 'm', count: 2 };
    const result = validateMultiVersion(raw);
    expect(result?.error.type).toBe('validation');
    expect(result?.error.message).toMatch(/sourceFolderId/);
  });

  it('missing rulesFolderId → validation error', () => {
    const raw = { jd: 'job desc', sourceFolderId: 'x', model: 'm', count: 2 };
    const result = validateMultiVersion(raw);
    expect(result?.error.type).toBe('validation');
    expect(result?.error.message).toMatch(/rulesFolderId/);
  });

  it('missing model → validation error', () => {
    const raw = { jd: 'job desc', sourceFolderId: 'x', rulesFolderId: 'y', count: 2 };
    const result = validateMultiVersion(raw);
    expect(result?.error.type).toBe('validation');
    expect(result?.error.message).toMatch(/model/);
  });

  it('T6: count=1 → validation error mentioning 2-5', () => {
    const raw = { jd: 'jd', sourceFolderId: 'x', rulesFolderId: 'y', model: 'm', count: 1 };
    const result = validateMultiVersion(raw);
    expect(result?.ok).toBe(false);
    expect(result?.error.type).toBe('validation');
    expect(result?.error.message).toMatch(/2.*5|between 2 and 5/i);
  });

  it('T7: count=6 → validation error mentioning 2-5', () => {
    const raw = { jd: 'jd', sourceFolderId: 'x', rulesFolderId: 'y', model: 'm', count: 6 };
    const result = validateMultiVersion(raw);
    expect(result?.ok).toBe(false);
    expect(result?.error.type).toBe('validation');
    expect(result?.error.message).toMatch(/2.*5|between 2 and 5/i);
  });

  it('non-integer count → validation error', () => {
    const raw = { jd: 'jd', sourceFolderId: 'x', rulesFolderId: 'y', model: 'm', count: 2.5 };
    const result = validateMultiVersion(raw);
    expect(result?.error.type).toBe('validation');
    expect(result?.error.message).toMatch(/integer/);
  });

  it('count=0 → validation error', () => {
    const raw = { jd: 'jd', sourceFolderId: 'x', rulesFolderId: 'y', model: 'm', count: 0 };
    const result = validateMultiVersion(raw);
    expect(result?.error.type).toBe('validation');
  });

  it('T8: framings.length !== count → validation error', () => {
    const raw = {
      jd: 'jd', sourceFolderId: 'x', rulesFolderId: 'y', model: 'm',
      count: 3, framings: ['A', 'B'],
    };
    const result = validateMultiVersion(raw);
    expect(result?.ok).toBe(false);
    expect(result?.error.type).toBe('validation');
    expect(result?.error.message).toMatch(/framings.length/);
  });

  it('framings with non-string entry → validation error', () => {
    const raw = {
      jd: 'jd', sourceFolderId: 'x', rulesFolderId: 'y', model: 'm',
      count: 2, framings: ['A', 42],
    };
    const result = validateMultiVersion(raw);
    expect(result?.error.type).toBe('validation');
  });

  it('valid minimal request → null', () => {
    const raw = { jd: 'jd', sourceFolderId: 'x', rulesFolderId: 'y', model: 'm', count: 2 };
    expect(validateMultiVersion(raw)).toBeNull();
  });

  it('valid request with custom framings matching count → null', () => {
    const raw = {
      jd: 'jd', sourceFolderId: 'x', rulesFolderId: 'y', model: 'm',
      count: 2, framings: ['Alpha', 'Beta'],
    };
    expect(validateMultiVersion(raw)).toBeNull();
  });

  it('count=5 (max) → null', () => {
    const raw = { jd: 'jd', sourceFolderId: 'x', rulesFolderId: 'y', model: 'm', count: 5 };
    expect(validateMultiVersion(raw)).toBeNull();
  });

  it('count=2 (min) → null', () => {
    const raw = { jd: 'jd', sourceFolderId: 'x', rulesFolderId: 'y', model: 'm', count: 2 };
    expect(validateMultiVersion(raw)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// handleMultiVersion — happy path
// ---------------------------------------------------------------------------

describe('handleMultiVersion — happy path', () => {
  it('T1: count=2 → returns exactly 2 variants', () => {
    const deps = makeDeps();
    const req = makeBaseRequest({ count: 2 });
    const result = handleMultiVersion(deps, req);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.variants).toHaveLength(2);
  });

  it('T2: count=3 with custom framings → variant labels match framings', () => {
    const deps = makeDeps();
    const framings = ['Systems thinking', 'People leadership', 'Revenue growth'];
    const req = makeBaseRequest({ count: 3, framings });
    const result = handleMultiVersion(deps, req);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.variants.map(v => v.label)).toEqual(framings);
  });

  it('T3: each variant has non-empty markdown and framing string', () => {
    const deps = makeDeps(() =>
      makeClaudeResponse('# Resume\n\n## Summary\nExperienced engineer.\n\n## Experience\n- Built things'),
    );
    const req = makeBaseRequest({ count: 3 });
    const result = handleMultiVersion(deps, req);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const v of result.variants) {
      expect(v.markdown.length).toBeGreaterThan(0);
      expect(v.framing.length).toBeGreaterThan(0);
    }
  });

  it('T4: cost.totalUsd is sum of per-call costs (3 calls × haiku rate)', () => {
    // 500 input + 800 output tokens × 3 calls at haiku rates
    // input: 500 * 1.0 / 1_000_000 = 0.0005; output: 800 * 5.0 / 1_000_000 = 0.004
    // per call ≈ 0.0045; × 3 = 0.0135
    const deps = makeDeps(() => makeClaudeResponse('# Resume\n\n## Experience', 500, 800));
    const req = makeBaseRequest({ count: 3 });
    const result = handleMultiVersion(deps, req);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const perCall = (500 * 1.0 + 800 * 5.0) / 1_000_000;
    const expected = perCall * 3;
    expect(Math.abs(result.cost.totalUsd - expected)).toBeLessThan(0.001);
  });

  it('T10: default framings used when req.framings is undefined', () => {
    const deps = makeDeps();
    const req = makeBaseRequest({ count: 3, framings: undefined });
    const result = handleMultiVersion(deps, req);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.variants[0].label).toBe('Technical depth');
    expect(result.variants[1].label).toBe('Leadership');
    expect(result.variants[2].label).toBe('Business outcomes');
  });

  it('T11: source files read exactly once, not once per variant', () => {
    const deps = makeDeps();
    const req = makeBaseRequest({ count: 4 });
    handleMultiVersion(deps, req);
    expect(deps.drive.readSourceFiles).toHaveBeenCalledTimes(1);
  });

  it('rule files read exactly once, not once per variant', () => {
    const deps = makeDeps();
    const req = makeBaseRequest({ count: 4 });
    handleMultiVersion(deps, req);
    expect(deps.drive.readRuleFiles).toHaveBeenCalledTimes(1);
  });

  it('framing directive is included in each variant.framing string', () => {
    const deps = makeDeps();
    const req = makeBaseRequest({ count: 2, framings: ['Alpha', 'Beta'] });
    const result = handleMultiVersion(deps, req);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.variants[0].framing).toContain('Alpha');
    expect(result.variants[1].framing).toContain('Beta');
  });

  it('framing directive is injected into Claude system prompt per call', () => {
    const deps = makeDeps();
    const req = makeBaseRequest({ count: 2, framings: ['Alpha', 'Beta'] });
    handleMultiVersion(deps, req);
    const calls = (deps.claude.call as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0][0].system[0].text).toContain('Alpha');
    expect(calls[1][0].system[0].text).toContain('Beta');
  });

  it('count=5 (max) → 5 variants', () => {
    const deps = makeDeps();
    const req = makeBaseRequest({ count: 5 });
    const result = handleMultiVersion(deps, req);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.variants).toHaveLength(5);
  });

  it('cost tokens accumulate across all variant calls', () => {
    const deps = makeDeps(() => makeClaudeResponse('# Resume\n\n## Exp', 100, 200));
    const req = makeBaseRequest({ count: 3 });
    const result = handleMultiVersion(deps, req);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cost.inputTokens).toBe(300);   // 100 × 3
    expect(result.cost.outputTokens).toBe(600);  // 200 × 3
  });

  it('markdown is trimmed (no leading/trailing whitespace)', () => {
    const deps = makeDeps(() => makeClaudeResponse('  # Resume\n\n## Exp\n  '));
    const req = makeBaseRequest({ count: 2 });
    const result = handleMultiVersion(deps, req);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const v of result.variants) {
      expect(v.markdown).toBe(v.markdown.trim());
    }
  });

  it('T8: empty source materials → handles gracefully (empty text section)', () => {
    const deps = makeDeps(
      () => makeClaudeResponse('# Resume\n\n## Experience\n- Nothing'),
      () => ({ text: '', files: [], totalTokens: 0 }),
    );
    const req = makeBaseRequest({ count: 2 });
    const result = handleMultiVersion(deps, req);
    expect(result.ok).toBe(true);
  });

  it('company and role included in user message when provided', () => {
    const deps = makeDeps();
    const req = makeBaseRequest({ count: 2, company: 'Initech', role: 'Staff Engineer' });
    handleMultiVersion(deps, req);
    const calls = (deps.claude.call as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0][0].messages[0].content).toContain('Initech');
    expect(calls[0][0].messages[0].content).toContain('Staff Engineer');
  });

  it('null company/role do not crash and omit the Position line', () => {
    const deps = makeDeps();
    const req = makeBaseRequest({ count: 2, company: null, role: null });
    const result = handleMultiVersion(deps, req);
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// handleMultiVersion — error paths
// ---------------------------------------------------------------------------

describe('handleMultiVersion — error paths', () => {
  it('T9: Claude failure on variant 2 → ok: false, retryable: true', () => {
    let callCount = 0;
    const claudeImpl = () => {
      callCount++;
      if (callCount === 2) {
        throw new Error('Simulated Claude timeout');
      }
      return makeClaudeResponse('# Resume\n\n## Experience\n- Built things');
    };
    const deps = makeDeps(claudeImpl);
    const req = makeBaseRequest({ count: 3 });
    const result = handleMultiVersion(deps, req);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.retryable).toBe(true);
    expect(result.error.type).toBe('server');
    expect(result.error.message).toContain('Variant 2');
  });

  it('Claude failure on variant 1 → ok: false immediately', () => {
    const deps = makeDeps(() => { throw new Error('Auth failed'); });
    const req = makeBaseRequest({ count: 3 });
    const result = handleMultiVersion(deps, req);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.type).toBe('server');
  });

  it('drive.readSourceFiles throws → drive error', () => {
    const deps = makeDeps();
    (deps.drive.readSourceFiles as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('Folder not found: source-folder-id');
    });
    const req = makeBaseRequest({ count: 2 });
    const result = handleMultiVersion(deps, req);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.type).toBe('drive');
  });

  it('drive.readRuleFiles throws → drive error with "Rules folder" prefix', () => {
    const deps = makeDeps();
    (deps.drive.readRuleFiles as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('Empty folder');
    });
    const req = makeBaseRequest({ count: 2 });
    const result = handleMultiVersion(deps, req);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.type).toBe('drive');
    expect(result.error.message).toContain('Rules folder');
  });

  it('failure on last variant → still ok: false (all-or-nothing)', () => {
    let callCount = 0;
    const claudeImpl = () => {
      callCount++;
      if (callCount === 3) throw new Error('Rate limit');
      return makeClaudeResponse('# Resume\n\n## Experience\n- Built things');
    };
    const deps = makeDeps(claudeImpl);
    const req = makeBaseRequest({ count: 3 });
    const result = handleMultiVersion(deps, req);
    expect(result.ok).toBe(false);
    // No partial variants returned
  });
});

// ---------------------------------------------------------------------------
// accumulateCost helper
// ---------------------------------------------------------------------------

describe('accumulateCost', () => {
  it('sums all fields correctly', () => {
    const a = { inputTokens: 100, outputTokens: 200, cacheReadTokens: 10, cacheCreationTokens: 5, totalUsd: 0.0045 };
    const b = { inputTokens: 150, outputTokens: 300, cacheReadTokens: 20, cacheCreationTokens: 8, totalUsd: 0.0065 };
    const result = accumulateCost(a, b);
    expect(result.inputTokens).toBe(250);
    expect(result.outputTokens).toBe(500);
    expect(result.cacheReadTokens).toBe(30);
    expect(result.cacheCreationTokens).toBe(13);
    expect(result.totalUsd).toBeCloseTo(0.011, 4);
  });

  it('rounds totalUsd to 4 decimal places', () => {
    const a = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, totalUsd: 0.00001 };
    const b = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, totalUsd: 0.00002 };
    const result = accumulateCost(a, b);
    // 0.00001 + 0.00002 = 0.00003, rounded to 4dp = 0.0000
    expect(result.totalUsd.toString().split('.')[1]?.length ?? 0).toBeLessThanOrEqual(4);
  });

  it('accumulating zeros returns zeros', () => {
    const zero = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, totalUsd: 0 };
    const result = accumulateCost(zero, zero);
    expect(result.totalUsd).toBe(0);
    expect(result.inputTokens).toBe(0);
  });
});
