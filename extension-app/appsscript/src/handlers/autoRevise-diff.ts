import type {
  AutoReviseDiff,
  ReviseTargetScope,
} from '../types/api-contract.js';
import { log } from '../lib/structuredLog.js';

interface LineRange {
  start: number;
  end: number;
}

export function stripFences(text: string): string {
  const fenceRe = /^\s*```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/;
  const match = text.match(fenceRe);
  if (match && match[1] !== undefined) return match[1];
  return text;
}

function normaliseLineEndings(s: string): string {
  return s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

export function splitNormalisedLines(s: string): string[] {
  return normaliseLineEndings(s).split('\n');
}

export function computeDiff(original: string, revised: string): AutoReviseDiff[] {
  const o = splitNormalisedLines(original);
  const r = splitNormalisedLines(revised);
  const diff: AutoReviseDiff[] = [];
  const max = Math.max(o.length, r.length);
  for (let i = 0; i < max; i++) {
    const beforePresent = i < o.length;
    const afterPresent = i < r.length;
    const before = beforePresent ? o[i] : '';
    const after = afterPresent ? r[i] : '';
    if (beforePresent !== afterPresent || before !== after) {
      diff.push({ lineIndex: i, before, after });
    }
  }
  return diff;
}

function findBulletRange(originalLines: string[], bulletId: string): LineRange | null {
  const needle = `bullet-id: ${bulletId}`;
  for (let i = 0; i < originalLines.length; i++) {
    if (originalLines[i].includes(needle)) {
      return { start: i, end: i };
    }
  }
  return null;
}

function findSectionRange(originalLines: string[], sectionName: string): LineRange | null {
  let startIdx = -1;
  let startLevel = 0;
  for (let i = 0; i < originalLines.length; i++) {
    const m = originalLines[i].match(/^(#{1,6})\s+(.+?)\s*$/);
    if (m && m[2].trim().toLowerCase() === sectionName.toLowerCase()) {
      startIdx = i;
      startLevel = m[1].length;
      break;
    }
  }
  if (startIdx === -1) return null;

  let endIdx = originalLines.length - 1;
  for (let i = startIdx + 1; i < originalLines.length; i++) {
    const m = originalLines[i].match(/^(#{1,6})\s+/);
    if (m && m[1].length <= startLevel) {
      endIdx = i - 1;
      break;
    }
  }
  return { start: startIdx, end: endIdx };
}

function findRoleRange(originalLines: string[], companyName: string): LineRange | null {
  let startIdx = -1;
  let startLevel = 0;
  const lower = companyName.toLowerCase();
  for (let i = 0; i < originalLines.length; i++) {
    const m = originalLines[i].match(/^(#{1,6})\s+(.+?)\s*$/);
    if (m && m[2].toLowerCase().includes(lower)) {
      startIdx = i;
      startLevel = m[1].length;
      break;
    }
  }
  if (startIdx === -1) return null;

  let endIdx = originalLines.length - 1;
  for (let i = startIdx + 1; i < originalLines.length; i++) {
    const m = originalLines[i].match(/^(#{1,6})\s+/);
    if (m && m[1].length <= startLevel) {
      endIdx = i - 1;
      break;
    }
  }
  return { start: startIdx, end: endIdx };
}

function rangeContains(range: LineRange, lineIndex: number): boolean {
  return lineIndex >= range.start && lineIndex <= range.end;
}

export function partitionUnauthorized(
  diff: AutoReviseDiff[],
  scope: ReviseTargetScope,
  originalLines: string[],
): AutoReviseDiff[] {
  if (scope.kind === 'whole-resume') return [];

  let range: LineRange | null = null;
  if (scope.kind === 'bullet') {
    range = findBulletRange(originalLines, scope.bulletId);
  } else if (scope.kind === 'section') {
    range = findSectionRange(originalLines, scope.sectionName);
  } else if (scope.kind === 'role') {
    range = findRoleRange(originalLines, scope.companyName);
  }

  if (!range) {
    log('warn', 'autoRevise: target scope not found in source markdown — treating all changes as unauthorized', {
      scopeKind: scope.kind,
    });
    return diff.slice();
  }

  const unauthorized: AutoReviseDiff[] = [];
  for (const d of diff) {
    if (d.lineIndex < originalLines.length) {
      if (!rangeContains(range, d.lineIndex)) {
        unauthorized.push(d);
      }
    } else if (range.end !== originalLines.length - 1) {
      unauthorized.push(d);
    }
  }
  return unauthorized;
}
