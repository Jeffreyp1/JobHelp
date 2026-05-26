export type ValidationSeverity = 'supported' | 'fair-rephrase' | 'exaggerated' | 'made-up';

export interface CritiqueFlag {
  readonly id: number;
  readonly severity: 'exaggerated' | 'made-up';
  readonly location: string;
  readonly draftText: string;
  readonly originalEvidence: string | null;
  readonly suggestedFix: string;
}

export interface Critique {
  readonly schemaVersion: 1;
  readonly jobId: string;
  readonly resumeVersion: number;
  readonly verdict: 'PASS' | 'BLOCK';
  readonly thresholdConfig: { readonly blockOn: ReadonlyArray<'made-up' | 'exaggerated'> };
  readonly counts: Record<ValidationSeverity | 'total', number>;
  readonly flagged: readonly CritiqueFlag[];
}

export interface ValidatorEdit {
  readonly flagId: number;
  readonly replaceWith: string | null;
}

export interface ValidatorEdits {
  readonly mode: 'edits';
  readonly edits: readonly ValidatorEdit[];
}

export interface ValidationResult {
  readonly ok: boolean;
  readonly errors: readonly string[];
}

export interface ApplyValidatorEditsInput {
  readonly prevContent: string;
  readonly critique: Critique;
  readonly edits: ValidatorEdits;
}

export interface ValidationTrust {
  readonly verdict: 'PASS' | 'BLOCK';
  readonly stage: 'coverage' | 'apply' | 'byte-equality' | 'complete';
  readonly checkedFlagIds: readonly number[];
  readonly appliedFlagIds: readonly number[];
  readonly errors: readonly string[];
}

export interface ApplyValidatorEditsResult {
  readonly verdict: 'PASS' | 'BLOCK';
  readonly content: string;
  readonly appliedFlagIds: readonly number[];
  readonly trust: ValidationTrust;
}

interface ApplyResult {
  readonly content: string;
  readonly appliedFlagIds: readonly number[];
  readonly editedLineIndices: readonly number[];
}

export function applyValidatorResumeEdits(input: ApplyValidatorEditsInput): ApplyValidatorEditsResult {
  const checkedFlagIds = input.critique.flagged.map((flag) => flag.id);
  const coverage = validateEditCoverage(input.critique, input.edits);
  if (!coverage.ok) {
    return blocked(input.prevContent, 'coverage', checkedFlagIds, [], coverage.errors);
  }

  let applied: ApplyResult;
  try {
    applied = applyEdits(input.prevContent, input.critique, input.edits);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'unknown apply error';
    return blocked(input.prevContent, 'apply', checkedFlagIds, [], [message]);
  }

  const byteCheck = validateByteEqualityOutsideEdits(
    input.prevContent,
    applied.content,
    input.critique,
    input.edits,
    applied.editedLineIndices,
  );
  if (!byteCheck.ok) {
    return blocked(
      input.prevContent,
      'byte-equality',
      checkedFlagIds,
      applied.appliedFlagIds,
      byteCheck.errors,
    );
  }

  return {
    verdict: 'PASS',
    content: applied.content,
    appliedFlagIds: applied.appliedFlagIds,
    trust: {
      verdict: 'PASS',
      stage: 'complete',
      checkedFlagIds,
      appliedFlagIds: applied.appliedFlagIds,
      errors: [],
    },
  };
}

export function validateEditCoverage(critique: Critique, edits: ValidatorEdits): ValidationResult {
  const errors: string[] = [];
  const flagIds = new Set(critique.flagged.map((flag) => flag.id));
  const editCounts = new Map<number, number>();

  for (const edit of edits.edits) {
    if (!flagIds.has(edit.flagId)) {
      errors.push(`Edit references unknown flagId ${edit.flagId}`);
    }
    editCounts.set(edit.flagId, (editCounts.get(edit.flagId) ?? 0) + 1);
    if (typeof edit.replaceWith === 'string' && edit.replaceWith.includes('\n')) {
      errors.push(
        `replaceWith for flagId ${edit.flagId} contains a newline; must be a single line of bullet text`,
      );
    }
  }

  for (const id of flagIds) {
    const count = editCounts.get(id) ?? 0;
    if (count === 0) errors.push(`Missing edit for flagId ${id}`);
    if (count > 1) errors.push(`Multiple edits for flagId ${id} (expected exactly one)`);
  }

  return { ok: errors.length === 0, errors };
}

export function applyEdits(prev: string, critique: Critique, edits: ValidatorEdits): ApplyResult {
  const lines = prev.split('\n');
  const applied: number[] = [];
  const editedLineIndices: number[] = [];

  const indexed = edits.edits.map((edit) => {
    const flag = critique.flagged.find((item) => item.id === edit.flagId);
    if (flag === undefined) throw new Error(`No critique flag for edit.flagId=${edit.flagId}`);
    return { edit, idx: findAnchorLine(lines, flag), flag };
  });

  indexed.sort((a, b) => b.idx - a.idx);

  for (const { edit, flag, idx } of indexed) {
    editedLineIndices.push(idx);
    if (edit.replaceWith === null) {
      lines.splice(idx, 1);
    } else {
      lines[idx] = replaceFlagInLine(lines[idx] ?? '', flag, edit.replaceWith, edit.flagId);
    }
    applied.push(edit.flagId);
  }

  return { content: lines.join('\n'), appliedFlagIds: applied, editedLineIndices };
}

export function validateByteEqualityOutsideEdits(
  prev: string,
  next: string,
  _critique: Critique,
  edits: ValidatorEdits,
  editedLineIndices: readonly number[],
): ValidationResult {
  const editedSet = new Set(editedLineIndices);
  const replacementBudget = new Map<string, number>();
  for (const edit of edits.edits) {
    if (typeof edit.replaceWith === 'string' && edit.replaceWith.length > 0) {
      const key = stripBullet(edit.replaceWith);
      replacementBudget.set(key, (replacementBudget.get(key) ?? 0) + 1);
    }
  }

  const errors: string[] = [];
  for (const op of alignLineDiff(prev.split('\n'), next.split('\n'))) {
    if (op.kind === 'equal') continue;
    if (op.kind === 'remove') {
      if (!editedSet.has(op.prevIndex)) {
        errors.push(`Removed line at prev index ${op.prevIndex} is not at a known edit site: ${quote(op.text)}`);
      }
      continue;
    }
    const key = stripBullet(op.text);
    const remaining = replacementBudget.get(key) ?? 0;
    if (remaining <= 0) {
      errors.push(`Added line is not authorized by any edit.replaceWith: ${quote(op.text)}`);
    } else {
      replacementBudget.set(key, remaining - 1);
    }
  }

  return { ok: errors.length === 0, errors };
}

function blocked(
  content: string,
  stage: ValidationTrust['stage'],
  checkedFlagIds: readonly number[],
  appliedFlagIds: readonly number[],
  errors: readonly string[],
): ApplyValidatorEditsResult {
  return {
    verdict: 'BLOCK',
    content,
    appliedFlagIds,
    trust: { verdict: 'BLOCK', stage, checkedFlagIds, appliedFlagIds, errors },
  };
}

function findAnchorLine(lines: readonly string[], flag: CritiqueFlag): number {
  const pathParts = flag.location.split('>').map((part) => part.trim()).filter(Boolean);
  const stack: string[] = [];
  const matchIndices: number[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    const headingMatch = /^(#{2,6})\s+(.+?)\s*$/.exec(line);
    if (headingMatch !== null) {
      const marks = headingMatch[1];
      const heading = headingMatch[2];
      if (marks !== undefined && heading !== undefined) {
        const level = marks.length - 2;
        stack.length = level;
        stack[level] = heading;
      }
      continue;
    }
    if (isInSection(stack, pathParts) && line.includes(flag.draftText)) matchIndices.push(i);
  }

  if (matchIndices.length === 0) {
    throw new Error(`Anchor not found for flagId ${flag.id}: "${flag.draftText.slice(0, 60)}..." in section "${flag.location}"`);
  }
  if (matchIndices.length > 1) {
    throw new Error(`Anchor not unique for flagId ${flag.id}: appears at lines [${matchIndices.join(', ')}] in section "${flag.location}"`);
  }
  const first = matchIndices[0];
  if (first === undefined) throw new Error(`Anchor not found for flagId ${flag.id}`);
  return first;
}

function isInSection(stack: readonly string[], pathParts: readonly string[]): boolean {
  if (pathParts.length === 0) return true;
  if (stack.length < pathParts.length) return false;
  for (let i = 0; i < pathParts.length; i += 1) {
    const heading = stack[i];
    const part = pathParts[i];
    if (heading === undefined || part === undefined || !matchesPathPart(heading, part)) return false;
  }
  return true;
}

function matchesPathPart(heading: string, part: string): boolean {
  const normalizedHeading = heading.trim().replace(/\s+/g, ' ');
  const normalizedPart = part.trim().replace(/\s+/g, ' ');
  return normalizedHeading === normalizedPart || normalizedHeading.startsWith(`${normalizedPart} `);
}

function replaceFlagInLine(
  line: string,
  flag: CritiqueFlag,
  replacement: string,
  flagId: number,
): string {
  if (isMarkdownBullet(replacement)) return replaceBulletLine(line, replacement);
  return replaceAnchorInLine(line, flag.draftText, replacement, flagId);
}

function isMarkdownBullet(value: string): boolean { return /^\s*[-*+]\s+/.test(value); }

function replaceBulletLine(line: string, replacement: string): string {
  const replacementMatch = /^(\s*)([-*+]\s+)(.*)$/.exec(replacement);
  if (replacementMatch === null) return replacement;
  const lineMatch = /^(\s*)([-*+]\s+)(.*)$/.exec(line);
  if (lineMatch === null) return replacement;
  const indent = lineMatch[1] ?? '';
  const marker = lineMatch[2] ?? '- ';
  const text = replacementMatch[3] ?? '';
  return `${indent}${marker}${text}`;
}

function replaceAnchorInLine(line: string, anchor: string, replacement: string, flagId: number): string {
  const index = line.indexOf(anchor);
  if (index < 0) throw new Error(`Anchor not found in line for flagId ${flagId}: "${anchor.slice(0, 60)}..."`);
  return `${line.slice(0, index)}${replacement}${line.slice(index + anchor.length)}`;
}

function stripBullet(value: string): string {
  return value.replace(/^\s*[-*+]\s+/, '').trim();
}

function quote(value: string): string {
  return JSON.stringify(value).slice(0, 200);
}
import { alignLineDiff } from './validator-line-diff.js';
