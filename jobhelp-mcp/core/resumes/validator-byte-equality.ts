import type { ValidationResult, ValidatorEdits } from './validator-edits.js';
import { alignLineDiff } from './validator-line-diff.js';

export function validateByteEqualityOutsideEdits(
  prev: string,
  next: string,
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

function stripBullet(value: string): string {
  return value.replace(/^\s*[-*+]\s+/, '').trim();
}

function quote(value: string): string {
  return JSON.stringify(value).slice(0, 200);
}
