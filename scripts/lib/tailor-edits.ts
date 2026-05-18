import { alignLineDiff } from './line-diff.js';

export type Severity = 'supported' | 'fair-rephrase' | 'exaggerated' | 'made-up';

export interface CritiqueFlag {
  id: number;
  severity: 'exaggerated' | 'made-up';
  location: string;
  draftText: string;
  originalEvidence: string | null;
  suggestedFix: string;
}

export interface Critique {
  schemaVersion: 1;
  jobId: string;
  resumeVersion: number;
  verdict: 'PASS' | 'BLOCK';
  thresholdConfig: { blockOn: Array<'made-up' | 'exaggerated'> };
  counts: Record<Severity | 'total', number>;
  flagged: CritiqueFlag[];
}

export interface Edit {
  flagId: number;
  replaceWith: string | null;
}

export interface Edits {
  mode: 'edits';
  edits: Edit[];
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

export function validateEditCoverage(critique: Critique, edits: Edits): ValidationResult {
  const errors: string[] = [];
  const flagIds = new Set(critique.flagged.map(f => f.id));
  const editCounts = new Map<number, number>();

  for (const e of edits.edits) {
    if (!flagIds.has(e.flagId)) {
      errors.push(`Edit references unknown flagId ${e.flagId}`);
    }
    editCounts.set(e.flagId, (editCounts.get(e.flagId) ?? 0) + 1);
    if (typeof e.replaceWith === 'string' && e.replaceWith.includes('\n')) {
      errors.push(`replaceWith for flagId ${e.flagId} contains a newline; must be a single line of bullet text`);
    }
  }

  for (const id of flagIds) {
    const count = editCounts.get(id) ?? 0;
    if (count === 0) errors.push(`Missing edit for flagId ${id}`);
    if (count > 1) errors.push(`Multiple edits for flagId ${id} (expected exactly one)`);
  }

  return { ok: errors.length === 0, errors };
}

export interface ApplyResult {
  content: string;
  appliedFlagIds: number[];
  editedLineIndices: number[];
}

export function applyEdits(prev: string, critique: Critique, edits: Edits): ApplyResult {
  const lines = prev.split('\n');
  const applied: number[] = [];
  const editedLineIndices: number[] = [];

  const indexed = edits.edits.map(e => {
    const flag = critique.flagged.find(f => f.id === e.flagId);
    if (!flag) throw new Error(`No critique flag for edit.flagId=${e.flagId}`);
    const idx = findAnchorLine(lines, flag);
    return { e, flag, idx };
  });

  indexed.sort((a, b) => b.idx - a.idx);

  for (const { e, flag, idx } of indexed) {
    editedLineIndices.push(idx);
    if (e.replaceWith === null) {
      lines.splice(idx, 1);
    } else {
      lines[idx] = replaceAnchorInLine(lines[idx], flag.draftText, e.replaceWith, e.flagId);
    }
    applied.push(e.flagId);
  }

  return { content: lines.join('\n'), appliedFlagIds: applied, editedLineIndices };
}

function findAnchorLine(lines: string[], flag: CritiqueFlag): number {
  const pathParts = flag.location.split('>').map(s => s.trim()).filter(Boolean);

  // Stack of heading text per level (level 0 = ##, level 1 = ###, ...).
  const stack: string[] = [];
  const inSection = (): boolean => {
    if (pathParts.length === 0) return true;
    if (stack.length < pathParts.length) return false;
    for (let k = 0; k < pathParts.length; k++) {
      if (typeof stack[k] !== 'string') return false;
      if (!matchesPathPart(stack[k], pathParts[k])) return false;
    }
    return true;
  };

  const matchIndices: number[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const headingMatch = line.match(/^(#{2,6})\s+(.+?)\s*$/);
    if (headingMatch) {
      const level = headingMatch[1].length - 2;
      const heading = headingMatch[2];
      // Truncate stack to length `level`, then push at index `level`.
      stack.length = level;
      stack[level] = heading;
      continue;
    }
    if (inSection() && line.includes(flag.draftText)) {
      matchIndices.push(i);
    }
  }

  if (matchIndices.length === 0) {
    throw new Error(`Anchor not found for flagId ${flag.id}: "${flag.draftText.slice(0, 60)}..." in section "${flag.location}"`);
  }
  if (matchIndices.length > 1) {
    throw new Error(`Anchor not unique for flagId ${flag.id}: appears at lines [${matchIndices.join(', ')}] in section "${flag.location}"`);
  }
  return matchIndices[0];
}

// matchesPathPart: equality after whitespace-normalization, OR heading begins with `part + ' '`
// (so a path "Acme Corp" matches a heading "Acme Corp — Software Engineer (2022-2024)").
// Substring containment is NOT allowed in either direction; "Acme" must not match "Acme Subsidiary".
function matchesPathPart(heading: string, part: string): boolean {
  const h = heading.trim().replace(/\s+/g, ' ');
  const p = part.trim().replace(/\s+/g, ' ');
  if (h === p) return true;
  return h.startsWith(p + ' ');
}

function replaceAnchorInLine(line: string, anchor: string, replacement: string, flagId: number): string {
  const i = line.indexOf(anchor);
  if (i < 0) throw new Error(`Anchor not found in line for flagId ${flagId}: "${anchor.slice(0, 60)}..."`);
  return line.slice(0, i) + replacement + line.slice(i + anchor.length);
}

export function validateByteEqualityOutsideEdits(
  prev: string,
  next: string,
  critique: Critique,
  edits: Edits,
  editedLineIndices: number[],
): ValidationResult {
  const prevLines = prev.split('\n');
  const nextLines = next.split('\n');

  const editedSet = new Set(editedLineIndices);
  const stripBullet = (s: string): string => s.replace(/^\s*-\s+/, '').trim();

  // Build a multiset of authorized replaceWith values (normalized). Each non-null replaceWith
  // can authorize at most one ADDED line in the diff.
  const replacementBudget = new Map<string, number>();
  for (const e of edits.edits) {
    if (typeof e.replaceWith === 'string' && e.replaceWith.length > 0) {
      const key = stripBullet(e.replaceWith);
      replacementBudget.set(key, (replacementBudget.get(key) ?? 0) + 1);
    }
  }

  const errors: string[] = [];
  const aligned = alignLineDiff(prevLines, nextLines);

  for (const op of aligned) {
    if (op.kind === 'equal') continue;
    if (op.kind === 'remove') {
      if (!editedSet.has(op.prevIndex)) {
        errors.push(
          `Removed line at prev index ${op.prevIndex} is not at a known edit site: ${JSON.stringify(op.text).slice(0, 200)}`,
        );
      }
      continue;
    }
    // op.kind === 'add'
    const key = stripBullet(op.text);
    const remaining = replacementBudget.get(key) ?? 0;
    if (remaining <= 0) {
      errors.push(
        `Added line is not authorized by any edit.replaceWith: ${JSON.stringify(op.text).slice(0, 200)}`,
      );
    } else {
      replacementBudget.set(key, remaining - 1);
    }
  }

  return { ok: errors.length === 0, errors };
}

