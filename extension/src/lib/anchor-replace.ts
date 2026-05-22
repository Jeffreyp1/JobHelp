export interface ApplyResult {
  next: string;
  editedLineIndices: number[];
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

export function findAnchorLine(
  lines: string[],
  draftText: string,
  sectionName: string,
): number {
  const matches: number[] = [];
  let currentSection: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const h = line.match(/^##\s+(.+?)\s*$/);
    if (h) {
      currentSection = h[1].trim();
      continue;
    }
    if (currentSection === sectionName && line.includes(draftText)) {
      matches.push(i);
    }
  }
  if (matches.length === 0) {
    throw new Error(
      `Anchor not found: "${draftText.slice(0, 60)}" in section "${sectionName}"`,
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `Anchor not unique: "${draftText.slice(0, 60)}" appears at lines [${matches.join(", ")}] in section "${sectionName}"`,
    );
  }
  return matches[0];
}

export function applyBulletEdit(
  prev: string,
  draftText: string,
  sectionName: string,
  replaceWith: string,
): ApplyResult {
  if (replaceWith.includes("\n")) {
    throw new Error("replaceWith for a bullet must not contain a newline");
  }
  const lines = prev.split("\n");
  const idx = findAnchorLine(lines, draftText, sectionName);
  const original = lines[idx];
  const leading = original.match(/^(\s*-\s+)/);
  if (!leading) {
    throw new Error(`Anchored line is not a bullet (no leading "- "): ${JSON.stringify(original).slice(0, 80)}`);
  }
  lines[idx] = leading[1] + replaceWith;
  return { next: lines.join("\n"), editedLineIndices: [idx] };
}

export function applySectionEdit(
  prev: string,
  sectionName: string,
  replaceBullets: string[],
): ApplyResult {
  const lines = prev.split("\n");
  let startIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const h = lines[i].match(/^##\s+(.+?)\s*$/);
    if (h && h[1].trim() === sectionName) {
      startIdx = i;
      break;
    }
  }
  if (startIdx === -1) {
    throw new Error(`Section not found: "${sectionName}"`);
  }
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) {
      endIdx = i;
      break;
    }
  }
  const headingLine = lines[startIdx];
  const newBlock = [headingLine, "", ...replaceBullets.map((b) => `- ${b}`), ""];
  const before = lines.slice(0, startIdx);
  const after = lines.slice(endIdx);
  const next = [...before, ...newBlock, ...after].join("\n");
  const editedLineIndices: number[] = [];
  for (let i = startIdx; i < endIdx; i++) editedLineIndices.push(i);
  return { next, editedLineIndices };
}

const stripBullet = (s: string): string => s.replace(/^\s*-\s+/, "").trim();

export function validateByteEqualityOutsideEdits(
  prev: string,
  next: string,
  editedLineIndices: number[],
  replacements: string[],
): ValidationResult {
  const prevLines = prev.split("\n");
  const nextLines = next.split("\n");
  const editedSet = new Set(editedLineIndices);
  const budget = new Map<string, number>();
  for (const r of replacements) {
    const key = stripBullet(r);
    budget.set(key, (budget.get(key) ?? 0) + 1);
  }
  const errors: string[] = [];
  const ops = alignDiff(prevLines, nextLines);
  for (const op of ops) {
    if (op.kind === "equal") continue;
    if (op.kind === "remove") {
      if (!editedSet.has(op.prevIndex)) {
        errors.push(`Unauthorised removal at prev line ${op.prevIndex}: ${JSON.stringify(op.text).slice(0, 160)}`);
      }
      continue;
    }
    const key = stripBullet(op.text);
    const remaining = budget.get(key) ?? 0;
    if (remaining <= 0) {
      errors.push(`Unauthorised addition: ${JSON.stringify(op.text).slice(0, 160)}`);
    } else {
      budget.set(key, remaining - 1);
    }
  }
  return { ok: errors.length === 0, errors };
}

type DiffOp =
  | { kind: "equal"; prevIndex: number; nextIndex: number; text: string }
  | { kind: "remove"; prevIndex: number; text: string }
  | { kind: "add"; nextIndex: number; text: string };

function alignDiff(prev: string[], next: string[]): DiffOp[] {
  const n = prev.length;
  const m = next.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (prev[i] === next[j]) lcs[i][j] = 1 + lcs[i + 1][j + 1];
      else lcs[i][j] = Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (prev[i] === next[j]) {
      ops.push({ kind: "equal", prevIndex: i, nextIndex: j, text: prev[i] });
      i++; j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      ops.push({ kind: "remove", prevIndex: i, text: prev[i] });
      i++;
    } else {
      ops.push({ kind: "add", nextIndex: j, text: next[j] });
      j++;
    }
  }
  while (i < n) { ops.push({ kind: "remove", prevIndex: i, text: prev[i] }); i++; }
  while (j < m) { ops.push({ kind: "add", nextIndex: j, text: next[j] }); j++; }
  return ops;
}
