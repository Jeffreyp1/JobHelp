/**
 * Tests for appsscript/src/handlers/autoRevise.ts
 *
 * Per E2 plan, auto-revise:
 *   - Accepts {currentMarkdown, targetScope, instruction, model}
 *   - System prompt MUST include rule 14-revision-discipline.md
 *   - Returns {revisedMarkdown, diff[], unauthorizedChanges[], cost}
 *   - Detects unauthorized changes outside the requested scope
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handleAutoRevise, validateAutoRevise } from '../../src/handlers/autoRevise.js';
import type { Deps } from '../../src/Code.js';
import type { AutoReviseRequest, ReviseTargetScope } from '../../src/types/api-contract.js';
import type { ClaudeClient, ClaudeRequest, ClaudeResponse } from '../../src/types/claude-api.js';
import { ClaudeApiError } from '../../src/types/claude-api.js';
import type { DriveOps } from '../../src/types/drive-ops.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const SAMPLE_MD = [
  '# Jane Doe',
  'jane@example.com',
  '',
  '## Experience',
  '',
  '### Google — Software Engineering Intern',
  'Summer 2024',
  '',
  '- <!-- bullet-id: B1 --> Built a thing for Google',
  '- <!-- bullet-id: B2 --> Improved another thing',
  '',
  '### Microsoft — Software Engineer',
  '2022-2024',
  '',
  '- <!-- bullet-id: B3 --> Shipped feature at Microsoft',
  '- <!-- bullet-id: B4 --> Optimised pipeline',
  '',
  '## Skills',
  '',
  'Python, TypeScript, Go',
].join('\n');

function makeClaudeResponse(text: string): ClaudeResponse {
  return {
    text,
    stopReason: 'end_turn',
    usage: {
      input_tokens: 600,
      output_tokens: 800,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
    model: 'claude-haiku-4-5-20251001',
  };
}

function makeClaudeMock(text: string): ClaudeClient {
  return { call: vi.fn(() => makeClaudeResponse(text)) };
}

function makeDriveMock(): DriveOps {
  return {
    readSourceFiles: vi.fn(),
    readRuleFiles: vi.fn(() => []),
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
    createFileInFolder: vi.fn(),
    createGoogleDoc: vi.fn(),
  } as DriveOps;
}

function makeDeps(claudeText: string): Deps {
  return {
    drive: makeDriveMock(),
    claude: makeClaudeMock(claudeText),
    prompt: { composeSystemPrompt: vi.fn(() => ({ type: 'text' as const, text: 'sys' })) },
  };
}

function makeRequest(overrides: Partial<AutoReviseRequest> = {}): AutoReviseRequest {
  return {
    action: 'auto_revise',
    currentMarkdown: SAMPLE_MD,
    targetScope: { kind: 'bullet', bulletId: 'B1' },
    instruction: 'Add a metric',
    model: 'claude-haiku-4-5-20251001',
    ...overrides,
  };
}

/** Replace one line in SAMPLE_MD by id substring; helper to construct test responses. */
function replaceLine(md: string, matcher: string, replacement: string): string {
  return md
    .split('\n')
    .map(line => (line.includes(matcher) ? replacement : line))
    .join('\n');
}

// ---------------------------------------------------------------------------
// validateAutoRevise
// ---------------------------------------------------------------------------

describe('validateAutoRevise', () => {
  it('returns null for valid bullet-scope', () => {
    const result = validateAutoRevise({
      currentMarkdown: 'x',
      instruction: 'tighten',
      model: 'm',
      targetScope: { kind: 'bullet', bulletId: 'B1' },
    });
    expect(result).toBeNull();
  });

  it('T6: missing instruction → validation error', () => {
    const result = validateAutoRevise({
      currentMarkdown: 'x',
      model: 'm',
      targetScope: { kind: 'whole-resume' },
    });
    expect(result?.error.type).toBe('validation');
  });

  it('T6b: empty instruction → validation error', () => {
    const result = validateAutoRevise({
      currentMarkdown: 'x',
      instruction: '',
      model: 'm',
      targetScope: { kind: 'whole-resume' },
    });
    expect(result?.error.type).toBe('validation');
  });

  it('T7: missing currentMarkdown → validation error', () => {
    const result = validateAutoRevise({
      instruction: 'do',
      model: 'm',
      targetScope: { kind: 'whole-resume' },
    });
    expect(result?.error.type).toBe('validation');
  });

  it('T8: invalid targetScope kind → validation error', () => {
    const result = validateAutoRevise({
      currentMarkdown: 'x',
      instruction: 'do',
      model: 'm',
      targetScope: { kind: 'galaxy-brain' },
    });
    expect(result?.error.type).toBe('validation');
  });

  it('T8b: bullet scope without bulletId → validation error', () => {
    const result = validateAutoRevise({
      currentMarkdown: 'x',
      instruction: 'do',
      model: 'm',
      targetScope: { kind: 'bullet' },
    });
    expect(result?.error.type).toBe('validation');
  });

  it('T8c: section scope without sectionName → validation error', () => {
    const result = validateAutoRevise({
      currentMarkdown: 'x',
      instruction: 'do',
      model: 'm',
      targetScope: { kind: 'section' },
    });
    expect(result?.error.type).toBe('validation');
  });

  it('T8d: role scope without companyName → validation error', () => {
    const result = validateAutoRevise({
      currentMarkdown: 'x',
      instruction: 'do',
      model: 'm',
      targetScope: { kind: 'role' },
    });
    expect(result?.error.type).toBe('validation');
  });

  it('missing model → validation error', () => {
    const result = validateAutoRevise({
      currentMarkdown: 'x',
      instruction: 'do',
      targetScope: { kind: 'whole-resume' },
    });
    expect(result?.error.type).toBe('validation');
  });
});

// ---------------------------------------------------------------------------
// handleAutoRevise — happy paths and scope checks
// ---------------------------------------------------------------------------

describe('handleAutoRevise — bullet scope (T1)', () => {
  it('T1: only target bullet changes; diff has 1 entry; unauthorizedChanges empty', () => {
    const revised = replaceLine(
      SAMPLE_MD,
      'bullet-id: B1',
      '- <!-- bullet-id: B1 --> Built a thing for Google that saved 30% latency',
    );
    const deps = makeDeps(revised);
    const result = handleAutoRevise(deps, makeRequest());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.diff.length).toBe(1);
    expect(result.diff[0].before).toContain('Built a thing for Google');
    expect(result.diff[0].after).toContain('30% latency');
    expect(result.unauthorizedChanges.length).toBe(0);
  });

  it('T11: bullet-scope keeps line count unchanged', () => {
    const revised = replaceLine(
      SAMPLE_MD,
      'bullet-id: B1',
      '- <!-- bullet-id: B1 --> Improved Google thing by 30%',
    );
    const deps = makeDeps(revised);
    const result = handleAutoRevise(deps, makeRequest());
    if (!result.ok) throw new Error('expected ok');
    const orig = SAMPLE_MD.split('\n').length;
    const next = result.revisedMarkdown.split('\n').length;
    expect(next).toBe(orig);
  });

  it('T5: out-of-scope change (different bullet) populates unauthorizedChanges', () => {
    let modified = replaceLine(
      SAMPLE_MD,
      'bullet-id: B1',
      '- <!-- bullet-id: B1 --> Built a thing for Google with 40% improvement',
    );
    modified = replaceLine(
      modified,
      'bullet-id: B3',
      '- <!-- bullet-id: B3 --> NAUGHTY OUT OF SCOPE EDIT',
    );
    const deps = makeDeps(modified);
    const result = handleAutoRevise(deps, makeRequest({
      targetScope: { kind: 'bullet', bulletId: 'B1' },
    }));
    if (!result.ok) throw new Error('expected ok');
    expect(result.unauthorizedChanges.length).toBeGreaterThan(0);
    const offending = result.unauthorizedChanges.find(c => c.after.includes('NAUGHTY'));
    expect(offending).toBeDefined();
  });
});

describe('handleAutoRevise — section scope (T2)', () => {
  it('T2: section-scope revision changing only inside section produces empty unauthorizedChanges', () => {
    // Modify "Skills" section content only (single line)
    const revised = SAMPLE_MD.replace(
      'Python, TypeScript, Go',
      'Python, TypeScript, Go, Rust',
    );
    const deps = makeDeps(revised);
    const result = handleAutoRevise(deps, makeRequest({
      targetScope: { kind: 'section', sectionName: 'Skills' },
    }));
    if (!result.ok) throw new Error('expected ok');
    expect(result.unauthorizedChanges.length).toBe(0);
    expect(result.diff.length).toBeGreaterThan(0);
  });

  it('section-scope: change outside the section is flagged unauthorized', () => {
    // Modify a line in Skills (in scope) AND a line in Experience (out of scope)
    let revised = SAMPLE_MD.replace(
      'Python, TypeScript, Go',
      'Python, TypeScript, Go, Rust',
    );
    revised = revised.replace('jane@example.com', 'jane.doe@example.com');
    const deps = makeDeps(revised);
    const result = handleAutoRevise(deps, makeRequest({
      targetScope: { kind: 'section', sectionName: 'Skills' },
    }));
    if (!result.ok) throw new Error('expected ok');
    expect(result.unauthorizedChanges.length).toBeGreaterThan(0);
  });
});

describe('handleAutoRevise — whole-resume scope (T3)', () => {
  it('T3: whole-resume scope: unauthorizedChanges always empty', () => {
    // Substantial rewrite
    const revised = SAMPLE_MD
      .replace('jane@example.com', 'jane.doe@example.com')
      .replace('Python, TypeScript, Go', 'Python, Rust')
      .replace('Built a thing for Google', 'Engineered scalable infra at Google');
    const deps = makeDeps(revised);
    const result = handleAutoRevise(deps, makeRequest({
      targetScope: { kind: 'whole-resume' },
    }));
    if (!result.ok) throw new Error('expected ok');
    expect(result.unauthorizedChanges.length).toBe(0);
    expect(result.diff.length).toBeGreaterThan(0);
  });
});

describe('handleAutoRevise — role scope', () => {
  it('role-scope: only the named role changes; others byte-identical', () => {
    const revised = replaceLine(
      SAMPLE_MD,
      'bullet-id: B1',
      '- <!-- bullet-id: B1 --> Built scalable infra at Google',
    );
    const deps = makeDeps(revised);
    const result = handleAutoRevise(deps, makeRequest({
      targetScope: { kind: 'role', companyName: 'Google' },
    }));
    if (!result.ok) throw new Error('expected ok');
    expect(result.unauthorizedChanges.length).toBe(0);
  });

  it('role-scope: change to other company flagged unauthorized', () => {
    const revised = replaceLine(
      SAMPLE_MD,
      'bullet-id: B3',
      '- <!-- bullet-id: B3 --> Touched Microsoft thing',
    );
    const deps = makeDeps(revised);
    const result = handleAutoRevise(deps, makeRequest({
      targetScope: { kind: 'role', companyName: 'Google' },
    }));
    if (!result.ok) throw new Error('expected ok');
    expect(result.unauthorizedChanges.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Diff & unchanged-response tests
// ---------------------------------------------------------------------------

describe('handleAutoRevise — diff calculation (T4, T13)', () => {
  it('T4: unchanged response produces empty diff', () => {
    const deps = makeDeps(SAMPLE_MD);
    const result = handleAutoRevise(deps, makeRequest({ targetScope: { kind: 'whole-resume' } }));
    if (!result.ok) throw new Error('expected ok');
    expect(result.diff.length).toBe(0);
    expect(result.unauthorizedChanges.length).toBe(0);
  });

  it('T13: diff entries have lineIndex, before, after', () => {
    const revised = replaceLine(
      SAMPLE_MD,
      'bullet-id: B1',
      '- <!-- bullet-id: B1 --> NEW',
    );
    const deps = makeDeps(revised);
    const result = handleAutoRevise(deps, makeRequest());
    if (!result.ok) throw new Error('expected ok');
    expect(result.diff.length).toBe(1);
    const d = result.diff[0];
    expect(typeof d.lineIndex).toBe('number');
    expect(d.lineIndex).toBeGreaterThanOrEqual(0);
    expect(typeof d.before).toBe('string');
    expect(typeof d.after).toBe('string');
    expect(d.before).not.toBe(d.after);
  });
});

// ---------------------------------------------------------------------------
// Rule 14 enforcement (system prompt)
// ---------------------------------------------------------------------------

describe('handleAutoRevise — rule 14 enforcement', () => {
  it('system prompt includes rule 14 revision discipline language', () => {
    const callMock = vi.fn<(req: ClaudeRequest) => ClaudeResponse>(() => makeClaudeResponse(SAMPLE_MD));
    const claude: ClaudeClient = { call: callMock };
    const deps: Deps = {
      drive: makeDriveMock(),
      claude,
      prompt: { composeSystemPrompt: vi.fn(() => ({ type: 'text' as const, text: 'sys' })) },
    };
    handleAutoRevise(deps, makeRequest({ targetScope: { kind: 'whole-resume' } }));
    expect(callMock).toHaveBeenCalledOnce();
    const args = callMock.mock.calls[0]?.[0];
    if (!args) throw new Error('expected callMock to have been called');
    const sysText = args.system.map(b => b.text).join('\n').toLowerCase();
    // Must include some form of rule 14 / revision discipline language
    expect(
      sysText.includes('revision discipline') ||
      sysText.includes('rule 14') ||
      sysText.includes('byte-identical')
    ).toBe(true);
  });

  it('user message includes the instruction text', () => {
    const callMock = vi.fn<(req: ClaudeRequest) => ClaudeResponse>(() => makeClaudeResponse(SAMPLE_MD));
    const claude: ClaudeClient = { call: callMock };
    const deps: Deps = {
      drive: makeDriveMock(),
      claude,
      prompt: { composeSystemPrompt: vi.fn(() => ({ type: 'text' as const, text: 'sys' })) },
    };
    handleAutoRevise(deps, makeRequest({
      targetScope: { kind: 'whole-resume' },
      instruction: 'UNIQUE_INSTRUCTION_MARKER',
    }));
    const args = callMock.mock.calls[0]?.[0];
    if (!args) throw new Error('expected callMock to have been called');
    expect(args.messages[0].content).toContain('UNIQUE_INSTRUCTION_MARKER');
  });
});

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

describe('handleAutoRevise — error paths', () => {
  it('T9: Claude failure returns retryable error', () => {
    const claude: ClaudeClient = {
      call: vi.fn(() => { throw new ClaudeApiError('rate_limit', 429, 'rate limited'); }),
    };
    const deps: Deps = {
      drive: makeDriveMock(),
      claude,
      prompt: { composeSystemPrompt: vi.fn(() => ({ type: 'text' as const, text: 'sys' })) },
    };
    const result = handleAutoRevise(deps, makeRequest());
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    expect(result.error.retryable).toBe(true);
  });

  it('T10: cost.totalUsd is positive on success', () => {
    const deps = makeDeps(SAMPLE_MD);
    const result = handleAutoRevise(deps, makeRequest({ targetScope: { kind: 'whole-resume' } }));
    if (!result.ok) throw new Error('expected ok');
    expect(result.cost.totalUsd).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Adversarial edge cases — rule 14 unauthorizedChanges detection
// ---------------------------------------------------------------------------

describe('handleAutoRevise — adversarial rule-14 enforcement', () => {
  // EC-1: Whitespace-only change outside scope. A trailing space added to the
  // contact line (out of scope when we ask to revise B1) must be flagged.
  // Byte-identical means same whitespace per rule 14.
  it('EC-1: trailing whitespace added outside scope is flagged unauthorized', () => {
    let revised = replaceLine(
      SAMPLE_MD,
      'bullet-id: B1',
      '- <!-- bullet-id: B1 --> Built a thing for Google with 30% gain',
    );
    // Add a single trailing space to the contact line (out of scope)
    revised = revised.replace('jane@example.com', 'jane@example.com ');
    const deps = makeDeps(revised);
    const result = handleAutoRevise(deps, makeRequest({
      targetScope: { kind: 'bullet', bulletId: 'B1' },
    }));
    if (!result.ok) throw new Error('expected ok');
    const offending = result.unauthorizedChanges.find(c => c.before === 'jane@example.com');
    expect(offending).toBeDefined();
    expect(offending?.after).toBe('jane@example.com ');
  });

  // EC-2: Punctuation flip (comma → semicolon) on the Skills line while
  // revising a bullet in Experience. Out of scope → must be flagged.
  it('EC-2: punctuation flip outside scope is flagged unauthorized', () => {
    let revised = replaceLine(
      SAMPLE_MD,
      'bullet-id: B1',
      '- <!-- bullet-id: B1 --> Built a thing for Google with 30% gain',
    );
    revised = revised.replace(
      'Python, TypeScript, Go',
      'Python; TypeScript; Go',
    );
    const deps = makeDeps(revised);
    const result = handleAutoRevise(deps, makeRequest({
      targetScope: { kind: 'bullet', bulletId: 'B1' },
    }));
    if (!result.ok) throw new Error('expected ok');
    const offending = result.unauthorizedChanges.find(c =>
      c.before === 'Python, TypeScript, Go' && c.after === 'Python; TypeScript; Go',
    );
    expect(offending).toBeDefined();
  });

  // EC-3: A single period appended to the end of an out-of-scope line.
  it('EC-3: terminal period added outside scope is flagged unauthorized', () => {
    let revised = replaceLine(
      SAMPLE_MD,
      'bullet-id: B1',
      '- <!-- bullet-id: B1 --> Built a thing for Google with 30% gain',
    );
    revised = revised.replace(
      'Python, TypeScript, Go',
      'Python, TypeScript, Go.',
    );
    const deps = makeDeps(revised);
    const result = handleAutoRevise(deps, makeRequest({
      targetScope: { kind: 'bullet', bulletId: 'B1' },
    }));
    if (!result.ok) throw new Error('expected ok');
    const offending = result.unauthorizedChanges.find(c => c.after === 'Python, TypeScript, Go.');
    expect(offending).toBeDefined();
  });

  // EC-4: Trailing whitespace/newlines on the WHOLE response.
  // Original ends with "Python, TypeScript, Go" (no trailing newline).
  // Revised string ends with "\n\n\n" — appended trailing newlines.
  // stripFences() preserves interior whitespace, so trailing-newline drift
  // survives into the diff and surfaces as unauthorized changes for any
  // scope narrower than whole-resume. Rule 14 "same line breaks" enforced.
  it('EC-4: trailing newlines on the response are preserved and flagged as unauthorized changes', () => {
    let revised = replaceLine(
      SAMPLE_MD,
      'bullet-id: B1',
      '- <!-- bullet-id: B1 --> Built a thing for Google with 30% gain',
    );
    revised = revised + '\n\n\n';
    const deps = makeDeps(revised);
    const result = handleAutoRevise(deps, makeRequest({
      targetScope: { kind: 'bullet', bulletId: 'B1' },
    }));
    if (!result.ok) throw new Error('expected ok');
    // B1 in-scope edit (1) + 3 added trailing-newline lines past EOF of
    // the original (all out of scope for a bullet-scope revision).
    expect(result.diff.length).toBe(4);
    expect(result.unauthorizedChanges.length).toBe(3);
    // stripFences no longer .trim()s — trailing newlines are preserved on
    // the returned markdown so the UI sees exactly what Claude produced.
    expect(result.revisedMarkdown.endsWith('\n')).toBe(true);
  });

  // EC-5: A whitespace-only instruction provides no authorisation per
  // rule 14 ("instruction must explicitly authorise lines"), so the
  // validator rejects it with a non-whitespace error.
  it('EC-5: whitespace-only instruction → validation error (must be non-whitespace)', () => {
    const result = validateAutoRevise({
      currentMarkdown: 'x',
      instruction: '   \n\t  ',
      model: 'm',
      targetScope: { kind: 'whole-resume' },
    });
    expect(result?.error.type).toBe('validation');
    expect(result?.error.message).toMatch(/non-whitespace/i);
  });

  // EC-6: targetScope object with NO 'kind' field at all.
  // (Distinct from invalid kind value — exercises a different validator branch.)
  it('EC-6: targetScope missing kind field → validation error', () => {
    const result = validateAutoRevise({
      currentMarkdown: 'x',
      instruction: 'do',
      model: 'm',
      targetScope: { bulletId: 'B1' },
    });
    expect(result?.error.type).toBe('validation');
    expect(result?.error.message).toContain('kind');
  });

  // EC-7: Bullet scope where bulletId does not exist anywhere in the markdown.
  // The handler logs a warning and treats EVERY diff entry as unauthorized.
  it('EC-7: bullet scope with non-existent bulletId → all changes flagged unauthorized', () => {
    // Claude returns markdown with a change somewhere (e.g. modifying B1)
    const revised = replaceLine(
      SAMPLE_MD,
      'bullet-id: B1',
      '- <!-- bullet-id: B1 --> Reworked Google line',
    );
    const deps = makeDeps(revised);
    const result = handleAutoRevise(deps, makeRequest({
      targetScope: { kind: 'bullet', bulletId: 'NOPE-999' },
    }));
    if (!result.ok) throw new Error('expected ok');
    expect(result.diff.length).toBeGreaterThan(0);
    // Every diff line is treated as unauthorized because the scope cannot be
    // located in the source.
    expect(result.unauthorizedChanges.length).toBe(result.diff.length);
  });

  // EC-8: Role scope where the company name appears in two ### headings.
  // findRoleRange uses the FIRST match. This test documents that behavior:
  // changes within the first matching role are authorized, but changes in
  // the second (also-named) role are flagged unauthorized.
  it('EC-8: role scope with duplicate company headings uses first match only (documents first-match behavior)', () => {
    const dupMd = [
      '# Jane Doe',
      '',
      '## Experience',
      '',
      '### Acme — Engineer I',
      '- <!-- bullet-id: A1 --> First Acme stint',
      '',
      '### Other Co — Lead',
      '- <!-- bullet-id: O1 --> Other thing',
      '',
      '### Acme — Engineer II',
      '- <!-- bullet-id: A2 --> Second Acme stint',
    ].join('\n');
    // Modify both Acme bullets
    const revised = dupMd
      .replace('First Acme stint', 'First Acme stint — improved')
      .replace('Second Acme stint', 'Second Acme stint — improved');
    const deps = makeDeps(revised);
    const result = handleAutoRevise(deps, makeRequest({
      currentMarkdown: dupMd,
      targetScope: { kind: 'role', companyName: 'Acme' },
    }));
    if (!result.ok) throw new Error('expected ok');
    // Diff should have 2 changes (one per Acme bullet)
    expect(result.diff.length).toBe(2);
    // First-match behavior: the SECOND Acme heading's content is NOT in scope,
    // so the change to A2 should appear in unauthorizedChanges.
    const offendingA2 = result.unauthorizedChanges.find(c => c.after.includes('Second Acme stint — improved'));
    expect(offendingA2).toBeDefined();
    // The change to A1 should NOT be flagged.
    const offendingA1 = result.unauthorizedChanges.find(c => c.after.includes('First Acme stint — improved'));
    expect(offendingA1).toBeUndefined();
  });

  // EC-9: whole-resume scope on a tiny one-line resume.
  it('EC-9: whole-resume scope works on a one-line resume', () => {
    const tiny = '- <!-- bullet-id: T1 --> One liner';
    const revised = '- <!-- bullet-id: T1 --> One liner with metric 50%';
    const deps = makeDeps(revised);
    const result = handleAutoRevise(deps, makeRequest({
      currentMarkdown: tiny,
      targetScope: { kind: 'whole-resume' },
    }));
    if (!result.ok) throw new Error('expected ok');
    expect(result.diff.length).toBe(1);
    expect(result.diff[0].lineIndex).toBe(0);
    expect(result.unauthorizedChanges.length).toBe(0);
    expect(result.revisedMarkdown).toBe(revised);
  });

  // EC-10: Out-of-scope changes still produce ok:true so the UI can warn the
  // user via unauthorizedChanges. Confirms revision is NOT auto-rejected at
  // the handler level — that's the UI's job per the file header comment.
  it('EC-10: unauthorized changes still return ok:true (warning behaviour, not rejection)', () => {
    let revised = replaceLine(
      SAMPLE_MD,
      'bullet-id: B1',
      '- <!-- bullet-id: B1 --> Built a thing for Google with 30%',
    );
    revised = replaceLine(
      revised,
      'bullet-id: B3',
      '- <!-- bullet-id: B3 --> SILENT REWRITE Microsoft thing',
    );
    const deps = makeDeps(revised);
    const result = handleAutoRevise(deps, makeRequest({
      targetScope: { kind: 'bullet', bulletId: 'B1' },
    }));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.unauthorizedChanges.length).toBeGreaterThan(0);
    // revisedMarkdown is still returned (UI decides whether to apply)
    expect(result.revisedMarkdown).toContain('SILENT REWRITE');
  });

  // EC-11: Claude returns malformed markdown (no headings, no bullet ids).
  // Current behaviour: handler does NOT validate structure — it just diffs
  // line-by-line and reports unauthorizedChanges. Returns ok:true.
  // (If we wanted to reject malformed output we'd need a structural check.)
  it('EC-11: malformed markdown response is diffed line-by-line (ok:true with many unauthorized lines)', () => {
    const garbage = 'This is not a resume at all.\nJust plain text.\nNo headings.';
    const deps = makeDeps(garbage);
    const result = handleAutoRevise(deps, makeRequest({
      targetScope: { kind: 'bullet', bulletId: 'B1' },
    }));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    // Tons of diff because almost every line differs.
    expect(result.diff.length).toBeGreaterThan(5);
    // B1 is not present in the response, so the bullet line itself diffs.
    // The original B1 line will be in result.diff (as a "removed" line that
    // got replaced by something else at that lineIndex), but since bulletId
    // B1 CAN be located in the original markdown, only changes OUTSIDE that
    // single line are unauthorized — so almost the entire diff is flagged.
    expect(result.unauthorizedChanges.length).toBeGreaterThan(0);
  });

  // EC-12: Very long currentMarkdown (>20k chars). Verifies no OOM and that
  // lineIndex on diff entries remains consistent (matches actual position).
  it('EC-12: very long markdown (>20k chars) — handler completes; diff lineIndex is consistent', () => {
    const filler = Array.from({ length: 600 }, (_, i) =>
      `- <!-- bullet-id: FILL${i} --> Filler bullet number ${i} with some descriptive text to bulk up length`,
    ).join('\n');
    const longMd = [
      '# Long Resume',
      'contact@example.com',
      '',
      '## Experience',
      '',
      '### Google — Engineer',
      '- <!-- bullet-id: B1 --> Original B1 text',
      filler,
    ].join('\n');
    expect(longMd.length).toBeGreaterThan(20000);

    const revised = replaceLine(
      longMd,
      'bullet-id: B1',
      '- <!-- bullet-id: B1 --> Revised B1 text with 50% impact',
    );
    const deps = makeDeps(revised);
    const result = handleAutoRevise(deps, makeRequest({
      currentMarkdown: longMd,
      targetScope: { kind: 'bullet', bulletId: 'B1' },
    }));
    if (!result.ok) throw new Error('expected ok');
    expect(result.diff.length).toBe(1);
    // Verify lineIndex matches actual position of B1 in the original
    const b1Index = longMd.split('\n').findIndex(l => l.includes('bullet-id: B1'));
    expect(result.diff[0].lineIndex).toBe(b1Index);
    expect(result.unauthorizedChanges.length).toBe(0);
  });

  // EC-13: Windows line endings (\r\n) in currentMarkdown.
  // computeDiff LF-normalises both sides before diffing, so a CRLF input
  // paired with an LF response produces exactly the same diff as if both
  // had been LF: just the single in-scope B1 edit, no spurious phantom-\r
  // changes, and no unauthorized changes.
  it('EC-13: CRLF input vs LF response normalises to LF before diffing — no spurious unauthorized changes', () => {
    const crlfMd = SAMPLE_MD.split('\n').join('\r\n');
    // Claude returns only the B1 edit, in LF form
    const revised = replaceLine(
      SAMPLE_MD,
      'bullet-id: B1',
      '- <!-- bullet-id: B1 --> Edited B1 with metric',
    );
    const deps = makeDeps(revised);
    const result = handleAutoRevise(deps, makeRequest({
      currentMarkdown: crlfMd,
      targetScope: { kind: 'bullet', bulletId: 'B1' },
    }));
    if (!result.ok) throw new Error('expected ok');
    // Only the single in-scope B1 edit — line-ending drift normalised away.
    expect(result.diff.length).toBe(1);
    expect(result.unauthorizedChanges.length).toBe(0);
  });

  // EC-14: Section scope where the section heading has different case in the
  // request vs the markdown. findSectionRange does case-insensitive match,
  // so this should locate the section correctly.
  it('EC-14: section name match is case-insensitive', () => {
    const revised = SAMPLE_MD.replace(
      'Python, TypeScript, Go',
      'Python, TypeScript, Go, Rust',
    );
    const deps = makeDeps(revised);
    const result = handleAutoRevise(deps, makeRequest({
      targetScope: { kind: 'section', sectionName: 'SKILLS' },
    }));
    if (!result.ok) throw new Error('expected ok');
    expect(result.unauthorizedChanges.length).toBe(0);
    expect(result.diff.length).toBe(1);
  });
});
