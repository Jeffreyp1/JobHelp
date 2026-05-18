import { createHash } from 'node:crypto';
import { applyEdits, validateEditCoverage, validateByteEqualityOutsideEdits, type Critique, type Edits } from './lib/tailor-edits.js';

function sha256(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

function section(title: string): void {
  console.log('\n' + '─'.repeat(72));
  console.log(title);
  console.log('─'.repeat(72));
}

const ORIGINAL_RESUME = `# Jane Doe
jane@example.com · github.com/janedoe

## Experience

### Acme Corp — Software Engineer (2022-2024)
- Contributed to a 4-person team building the V2 ingest pipeline.
- Wrote integration tests for the billing module.
- Mentored one summer intern on TypeScript fundamentals.

### Other Co — Software Engineering Intern (2021)
- Built internal dashboards using React and PostgreSQL.

## Education

### State University — B.S. Computer Science (2017-2021)
- GPA: 3.6
- Coursework: data structures, distributed systems, machine learning fundamentals.

## Skills
TypeScript, Python, PostgreSQL, React, Docker, Git.
`;

const DRAFT_V1 = `# Jane Doe
jane@example.com · github.com/janedoe

## Experience

### Acme Corp — Senior Software Engineer (2022-2024)
- Led a team of 12 engineers building the V2 ingest pipeline serving 50M users.
- Wrote integration tests for the billing module.
- Reduced API latency by 73% through novel caching architecture.

### Other Co — Software Engineering Intern (2021)
- Built internal dashboards using React and PostgreSQL.

## Education

### State University — B.S. Computer Science (2017-2021)
- GPA: 3.6
- Coursework: data structures, distributed systems, machine learning fundamentals.

## Skills
TypeScript, Python, PostgreSQL, React, Docker, Git, Kubernetes, Kafka.
`;

const CRITIQUE: Critique = {
  schemaVersion: 1,
  jobId: 'sim-2026-05-17',
  resumeVersion: 1,
  verdict: 'BLOCK',
  thresholdConfig: { blockOn: ['made-up', 'exaggerated'] },
  counts: { supported: 6, 'fair-rephrase': 0, exaggerated: 1, 'made-up': 2, total: 9 },
  flagged: [
    {
      id: 1,
      severity: 'exaggerated',
      location: 'Experience > Acme Corp',
      draftText: '- Led a team of 12 engineers building the V2 ingest pipeline serving 50M users.',
      originalEvidence: 'Contributed to a 4-person team building the V2 ingest pipeline.',
      suggestedFix: 'Replace with a grounded version of the original bullet (4-person team, no user-count claim).',
    },
    {
      id: 2,
      severity: 'made-up',
      location: 'Experience > Acme Corp',
      draftText: '- Reduced API latency by 73% through novel caching architecture.',
      originalEvidence: null,
      suggestedFix: 'Delete the bullet. No latency or caching work appears in the original.',
    },
    {
      id: 3,
      severity: 'made-up',
      location: 'Skills',
      draftText: 'TypeScript, Python, PostgreSQL, React, Docker, Git, Kubernetes, Kafka.',
      originalEvidence: 'TypeScript, Python, PostgreSQL, React, Docker, Git.',
      suggestedFix: 'Restore original skills list without Kubernetes and Kafka.',
    },
  ],
};

const TAILOR_EDITS_ROUND2: Edits = {
  mode: 'edits',
  edits: [
    {
      flagId: 1,
      replaceWith: '- Contributed to a 4-person team building the V2 ingest pipeline.',
    },
    {
      flagId: 2,
      replaceWith: null,
    },
    {
      flagId: 3,
      replaceWith: 'TypeScript, Python, PostgreSQL, React, Docker, Git.',
    },
  ],
};

section('Step 0 — original resume (source of truth)');
console.log(ORIGINAL_RESUME);
console.log(`SHA-256 (whole): ${sha256(ORIGINAL_RESUME)}`);

section('Step 1 — tailor round-1 output (with planted exaggerations + made-up content)');
console.log(DRAFT_V1);
console.log(`SHA-256 (whole): ${sha256(DRAFT_V1)}`);

section('Step 2 — what the validator produces (simulated)');
console.log(`Verdict: ${CRITIQUE.verdict}`);
console.log(`Counts: supported=${CRITIQUE.counts.supported}, fair-rephrase=${CRITIQUE.counts['fair-rephrase']}, exaggerated=${CRITIQUE.counts.exaggerated}, made-up=${CRITIQUE.counts['made-up']}, total=${CRITIQUE.counts.total}`);
console.log('\nFlagged claims:');
for (const f of CRITIQUE.flagged) {
  console.log(`  [${f.id}] (${f.severity}) ${f.location}`);
  console.log(`        draftText:        ${f.draftText.slice(0, 80)}`);
  console.log(`        originalEvidence: ${f.originalEvidence ?? '<silent>'}`);
}

section('Step 3 — tailor round-2 edits-only output');
for (const e of TAILOR_EDITS_ROUND2.edits) {
  const action = e.replaceWith === null ? 'DELETE' : 'REPLACE';
  console.log(`  flagId=${e.flagId}  ${action}  ${e.replaceWith ? `→ "${e.replaceWith.slice(0, 70)}"` : ''}`);
}

section('Step 4 — orchestrator validates edit coverage');
const coverage = validateEditCoverage(CRITIQUE, TAILOR_EDITS_ROUND2);
console.log(`validateEditCoverage: ok=${coverage.ok}, errors=${JSON.stringify(coverage.errors)}`);
if (!coverage.ok) {
  console.log('ABORT: coverage failed.');
  process.exit(1);
}

section('Step 5 — orchestrator applies edits mechanically');
const { content: DRAFT_V2, editedLineIndices } = applyEdits(DRAFT_V1, CRITIQUE, TAILOR_EDITS_ROUND2);
console.log(`editedLineIndices: ${JSON.stringify(editedLineIndices)} (these are the line indices in DRAFT_V1 that the orchestrator touched)`);

section('Step 6 — orchestrator validates byte-equality outside flagged spans');
const byteCheck = validateByteEqualityOutsideEdits(DRAFT_V1, DRAFT_V2, CRITIQUE, TAILOR_EDITS_ROUND2, editedLineIndices);
console.log(`validateByteEqualityOutsideEdits: ok=${byteCheck.ok}, errors=${JSON.stringify(byteCheck.errors)}`);
if (!byteCheck.ok) {
  console.log('ABORT: byte-equality invariant violated. Orchestrator would refuse to write v2.');
  process.exit(1);
}

section('Step 7 — final resume v2');
console.log(DRAFT_V2);
console.log(`SHA-256 (whole): ${sha256(DRAFT_V2)}`);

section('Step 8 — line-by-line diff (DRAFT_V1 → DRAFT_V2)');
const prevLines = DRAFT_V1.split('\n');
const nextLines = DRAFT_V2.split('\n');
const editedSet = new Set(editedLineIndices);

console.log('idx │ in flagged set │ status');
console.log('────┼────────────────┼──────────────────────────────────────────────');
let prevIdx = 0;
let nextIdx = 0;
const allEditedIndices = [...editedLineIndices].sort((a, b) => a - b);
for (let i = 0; i < prevLines.length; i++) {
  const isEdited = editedSet.has(i);
  const isDelete = isEdited && TAILOR_EDITS_ROUND2.edits.some(e => {
    const flag = CRITIQUE.flagged.find(f => f.id === e.flagId);
    return e.replaceWith === null && flag && prevLines[i].includes(flag.draftText.replace(/^- /, ''));
  });
  if (isDelete) {
    console.log(`${String(i).padStart(3)} │ YES (delete)   │ REMOVED: "${prevLines[i].slice(0, 50)}"`);
  } else if (isEdited) {
    console.log(`${String(i).padStart(3)} │ YES (replace)  │ FROM:    "${prevLines[i].slice(0, 50)}"`);
    console.log(`    │                │ TO:      "${nextLines[i - allEditedIndices.filter(x => x < i && TAILOR_EDITS_ROUND2.edits.find(e => {
      const flag = CRITIQUE.flagged.find(f => f.id === e.flagId);
      return e.replaceWith === null && flag && prevLines[x].includes(flag.draftText.replace(/^- /, ''));
    })).length].slice(0, 50)}"`);
  } else {
    // identity-mapped: this prev line appears unchanged in next at some offset
    const offset = allEditedIndices.filter(x => x < i && TAILOR_EDITS_ROUND2.edits.find(e => {
      const flag = CRITIQUE.flagged.find(f => f.id === e.flagId);
      return e.replaceWith === null && flag && prevLines[x].includes(flag.draftText.replace(/^- /, ''));
    })).length;
    const nextI = i - offset;
    const match = prevLines[i] === nextLines[nextI];
    console.log(`${String(i).padStart(3)} │ no             │ ${match ? 'unchanged' : '*** UNEXPECTED CHANGE ***'}: "${prevLines[i].slice(0, 50)}"`);
  }
}

section('Step 9 — hash-equality of every non-flagged line');
// For replacement edits, prev and next have the same line count up to that point; for delete edits, next has one fewer line.
// Build the "rest" by skipping all editedLineIndices in prev, and computing where each surviving line lands in next.
const editsByFlagId = new Map(TAILOR_EDITS_ROUND2.edits.map(e => [e.flagId, e]));
const flagByDraftText = new Map(CRITIQUE.flagged.map(f => [f.draftText.replace(/^- /, ''), f]));
const deleteCountBefore: number[] = [];
let runningDeletes = 0;
for (let i = 0; i < prevLines.length; i++) {
  deleteCountBefore.push(runningDeletes);
  if (editedSet.has(i)) {
    // Was this a delete?
    const flag = CRITIQUE.flagged.find(f => prevLines[i].includes(f.draftText.replace(/^- /, '')));
    const edit = flag ? editsByFlagId.get(flag.id) : undefined;
    if (edit && edit.replaceWith === null) runningDeletes++;
  }
}

let allMatch = true;
let mismatches: Array<{ prevIdx: number; nextIdx: number; prev: string; next: string }> = [];
const prevSurvivors: string[] = [];
const nextSurvivors: string[] = [];
for (let i = 0; i < prevLines.length; i++) {
  if (editedSet.has(i)) continue;
  const nextI = i - deleteCountBefore[i];
  prevSurvivors.push(prevLines[i]);
  nextSurvivors.push(nextLines[nextI]);
  if (prevLines[i] !== nextLines[nextI]) {
    allMatch = false;
    mismatches.push({ prevIdx: i, nextIdx: nextI, prev: prevLines[i], next: nextLines[nextI] });
  }
}

console.log(`Non-flagged lines (in DRAFT_V1):  ${prevSurvivors.length}`);
console.log(`Non-flagged lines (in DRAFT_V2):  ${nextSurvivors.length}`);
console.log(`Per-line hash matches:            ${allMatch ? 'ALL MATCH' : `${mismatches.length} MISMATCHES`}`);
console.log(`SHA-256 of non-flagged lines (v1): ${sha256(prevSurvivors.join('\n'))}`);
console.log(`SHA-256 of non-flagged lines (v2): ${sha256(nextSurvivors.join('\n'))}`);
console.log(`Hashes equal:                      ${sha256(prevSurvivors.join('\n')) === sha256(nextSurvivors.join('\n')) ? 'YES — byte-identical outside flagged spans' : 'NO — REGRESSION'}`);

if (mismatches.length > 0) {
  console.log('\nMismatches:');
  for (const m of mismatches) console.log(`  prev[${m.prevIdx}] vs next[${m.nextIdx}]:\n    "${m.prev}"\n    "${m.next}"`);
}

section('Step 10 — verdict');
const verdict = coverage.ok && byteCheck.ok && allMatch;
console.log(`SIMULATION ${verdict ? 'PASS' : 'FAIL'}`);
console.log(`  • Edit coverage:               ${coverage.ok ? 'ok' : 'FAIL'}`);
console.log(`  • Byte-equality invariant:     ${byteCheck.ok ? 'ok' : 'FAIL'}`);
console.log(`  • Per-line hash of non-flagged: ${allMatch ? 'ok' : 'FAIL'}`);
console.log(`  • Exaggerated bullet (flag 1):  ${DRAFT_V2.includes('Contributed to a 4-person team') ? 'fixed' : 'NOT FIXED'}`);
console.log(`  • Made-up bullet (flag 2):      ${!DRAFT_V2.includes('Reduced API latency') ? 'removed' : 'STILL PRESENT'}`);
console.log(`  • Made-up skills (flag 3):      ${!DRAFT_V2.includes('Kubernetes') && !DRAFT_V2.includes('Kafka') ? 'removed' : 'STILL PRESENT'}`);
console.log(`  • Untouched line "Wrote integration tests": ${DRAFT_V2.includes('Wrote integration tests for the billing module.') ? 'preserved' : 'CORRUPTED'}`);
console.log(`  • Untouched line "GPA: 3.6":               ${DRAFT_V2.includes('GPA: 3.6') ? 'preserved' : 'CORRUPTED'}`);

process.exit(verdict ? 0 : 1);
