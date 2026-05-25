import { err, ok, type Result } from '../types/result.js';

export interface ResumeBulletSelection {
  readonly id: string;
  readonly text: string;
  readonly startLine: number;
  readonly endLine: number;
}

export interface ResumeSectionSelection {
  readonly id: string;
  readonly title: string;
  readonly level: number;
  readonly startLine: number;
  readonly endLine: number;
  readonly bullets: readonly ResumeBulletSelection[];
}

export interface ResumeOutline {
  readonly sections: readonly ResumeSectionSelection[];
}

export interface ScopedReplacement {
  readonly selectionId: string;
  readonly replacementMarkdown: string;
}

export interface ApplyScopedResumeEditsArgs {
  readonly replacements: readonly ScopedReplacement[];
}

export interface ChangedSelection {
  readonly id: string;
  readonly type: 'section' | 'bullet';
  readonly startLine: number;
  readonly endLine: number;
}

export interface ApplyScopedResumeEditsResult {
  readonly content: string;
  readonly changedSelections: readonly ChangedSelection[];
}

export interface ScopedEditError {
  readonly type: 'invalid_input' | 'not_found';
  readonly message: string;
}

interface MutableSection {
  id: string;
  title: string;
  level: number;
  startLine: number;
  endLine: number;
  bullets: MutableBullet[];
  bulletCount: number;
}

interface MutableBullet {
  id: string;
  text: string;
  startLine: number;
  endLine: number;
}

type Selection =
  | { readonly type: 'section'; readonly id: string; readonly startLine: number; readonly endLine: number }
  | { readonly type: 'bullet'; readonly id: string; readonly startLine: number; readonly endLine: number };

export function getResumeOutline(markdown: string): ResumeOutline {
  const lines = splitForLineOps(markdown).lines;
  const sections: MutableSection[] = [];
  const stack: MutableSection[] = [];
  let sectionOrdinal = 0;
  let activeBullet: MutableBullet | undefined;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (heading !== null) {
      activeBullet = undefined;
      const level = heading[1]?.length ?? 1;
      const title = heading[2] ?? '';
      while (stack.length > 0 && (stack[stack.length - 1]?.level ?? 0) >= level) {
        const previous = stack.pop();
        if (previous !== undefined) previous.endLine = i - 1;
      }
      if (level > 1) {
        sectionOrdinal += 1;
        const section: MutableSection = {
          id: `section-${sectionOrdinal}-${slug(title)}`,
          title,
          level,
          startLine: i,
          endLine: lines.length - 1,
          bullets: [],
          bulletCount: 0,
        };
        sections.push(section);
        stack.push(section);
      }
      continue;
    }

    const current = stack[stack.length - 1];
    if (current !== undefined && /^\s*[-*+]\s+\S/.test(line)) {
      activeBullet = {
        id: `${current.id}-bullet-${current.bulletCount + 1}`,
        text: line,
        startLine: i,
        endLine: i,
      };
      current.bulletCount += 1;
      current.bullets.push(activeBullet);
      continue;
    }

    if (activeBullet !== undefined && /^(?: {2,}|\t)\S/.test(line)) {
      activeBullet.text = `${activeBullet.text}\n${line}`;
      activeBullet.endLine = i;
      continue;
    }

    if (line.trim().length > 0) activeBullet = undefined;
  }

  return {
    sections: sections.map((s) => ({
      id: s.id,
      title: s.title,
      level: s.level,
      startLine: s.startLine,
      endLine: s.endLine,
      bullets: s.bullets,
    })),
  };
}

export function applyScopedResumeEdits(
  markdown: string,
  args: ApplyScopedResumeEditsArgs,
): Result<ApplyScopedResumeEditsResult, ScopedEditError> {
  if (args.replacements.length === 0) {
    return err({ type: 'invalid_input', message: 'replacements must be non-empty' });
  }

  const outline = getResumeOutline(markdown);
  const selections = new Map<string, Selection>();
  for (const section of outline.sections) {
    selections.set(section.id, {
      type: 'section',
      id: section.id,
      startLine: section.startLine,
      endLine: section.endLine,
    });
    for (const bullet of section.bullets) {
      selections.set(bullet.id, {
        type: 'bullet',
        id: bullet.id,
        startLine: bullet.startLine,
        endLine: bullet.endLine,
      });
    }
  }

  const seen = new Set<string>();
  const pending: Array<{ selection: Selection; replacementMarkdown: string }> = [];
  for (const replacement of args.replacements) {
    if (replacement.replacementMarkdown.length === 0) {
      return err({
        type: 'invalid_input',
        message: `replacementMarkdown must be non-empty for ${replacement.selectionId}`,
      });
    }
    if (seen.has(replacement.selectionId)) {
      return err({
        type: 'invalid_input',
        message: `duplicate selectionId: ${replacement.selectionId}`,
      });
    }
    seen.add(replacement.selectionId);
    const selection = selections.get(replacement.selectionId);
    if (selection === undefined) {
      return err({
        type: 'not_found',
        message: `unknown selectionId: ${replacement.selectionId}`,
      });
    }
    pending.push({ selection, replacementMarkdown: replacement.replacementMarkdown });
  }

  pending.sort((a, b) => b.selection.startLine - a.selection.startLine);
  const overlapping = [...pending].sort((a, b) => a.selection.startLine - b.selection.startLine);
  for (let i = 1; i < overlapping.length; i += 1) {
    const previous = overlapping[i - 1];
    const current = overlapping[i];
    if (
      previous !== undefined &&
      current !== undefined &&
      current.selection.startLine <= previous.selection.endLine
    ) {
      return err({
        type: 'invalid_input',
        message: `overlapping selections: ${previous.selection.id}, ${current.selection.id}`,
      });
    }
  }

  const { lines, trailingNewline } = splitForLineOps(markdown);
  const changedSelections: ChangedSelection[] = [];
  for (const item of pending) {
    const replacementLines = splitReplacement(item.replacementMarkdown);
    lines.splice(
      item.selection.startLine,
      item.selection.endLine - item.selection.startLine + 1,
      ...replacementLines,
    );
    changedSelections.push({
      id: item.selection.id,
      type: item.selection.type,
      startLine: item.selection.startLine,
      endLine: item.selection.endLine,
    });
  }

  changedSelections.sort((a, b) => a.startLine - b.startLine);
  return ok({ content: joinLines(lines, trailingNewline), changedSelections });
}

function splitForLineOps(markdown: string): { lines: string[]; trailingNewline: boolean } {
  const trailingNewline = markdown.endsWith('\n');
  const body = trailingNewline ? markdown.slice(0, -1) : markdown;
  if (body.length === 0) return { lines: [], trailingNewline };
  return { lines: body.split('\n'), trailingNewline };
}

function splitReplacement(markdown: string): string[] {
  const body = markdown.endsWith('\n') ? markdown.slice(0, -1) : markdown;
  return body.split('\n');
}

function joinLines(lines: readonly string[], trailingNewline: boolean): string {
  return lines.join('\n') + (trailingNewline ? '\n' : '');
}

function slug(text: string): string {
  const normalized = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized.length > 0 ? normalized : 'section';
}
