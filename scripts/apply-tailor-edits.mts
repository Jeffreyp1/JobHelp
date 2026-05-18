import { readFileSync } from 'node:fs';
import { applyEdits, validateEditCoverage, validateByteEqualityOutsideEdits, type Critique, type Edits } from './lib/tailor-edits.js';

interface Input {
  prevContent: string;
  critique: Critique;
  edits: Edits;
}

let input: Input;
try {
  input = JSON.parse(readFileSync(0, 'utf8')) as Input;
} catch (e) {
  process.stdout.write(JSON.stringify({ ok: false, stage: 'parse', errors: [(e as Error).message] }));
  process.exit(2);
}

function shapeErrors(i: unknown): string[] {
  const errs: string[] = [];
  if (typeof i !== 'object' || i === null) {
    errs.push('input is not an object');
    return errs;
  }
  const obj = i as Record<string, unknown>;
  if (typeof obj.prevContent !== 'string') errs.push('input.prevContent must be a string');
  const c = obj.critique;
  if (typeof c !== 'object' || c === null) {
    errs.push('input.critique must be an object');
  } else if (!Array.isArray((c as { flagged?: unknown }).flagged)) {
    errs.push('input.critique.flagged must be an array');
  }
  const e = obj.edits;
  if (typeof e !== 'object' || e === null) {
    errs.push('input.edits must be an object');
  } else {
    const ee = e as { mode?: unknown; edits?: unknown };
    if (ee.mode !== 'edits') errs.push('input.edits.mode must equal "edits"');
    if (!Array.isArray(ee.edits)) errs.push('input.edits.edits must be an array');
  }
  return errs;
}

const shape = shapeErrors(input);
if (shape.length > 0) {
  process.stdout.write(JSON.stringify({ ok: false, stage: 'shape', errors: shape }));
  process.exit(2);
}

const { prevContent, critique, edits } = input;

const coverage = validateEditCoverage(critique, edits);
if (!coverage.ok) {
  process.stdout.write(JSON.stringify({ ok: false, stage: 'coverage', errors: coverage.errors }));
  process.exit(2);
}

let result;
try {
  result = applyEdits(prevContent, critique, edits);
} catch (e) {
  process.stdout.write(JSON.stringify({ ok: false, stage: 'apply', errors: [(e as Error).message] }));
  process.exit(2);
}

const byteCheck = validateByteEqualityOutsideEdits(prevContent, result.content, critique, edits, result.editedLineIndices);
if (!byteCheck.ok) {
  process.stdout.write(JSON.stringify({ ok: false, stage: 'byte-equality', errors: byteCheck.errors }));
  process.exit(2);
}

process.stdout.write(JSON.stringify({ ok: true, content: result.content, appliedFlagIds: result.appliedFlagIds }));
