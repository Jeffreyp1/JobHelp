export interface MarkdownRange {
  from: number;
  to: number;
}

export interface SelectionReviseScope extends MarkdownRange {
  kind: 'selection';
  excerpt: string;
  sectionName: string;
}

interface LineRange extends MarkdownRange {
  contentTo: number;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function lineRanges(markdown: string): LineRange[] {
  const ranges: LineRange[] = [];
  const newline = /\r\n|\n|\r/g;
  let start = 0;
  let match: RegExpExecArray | null;
  while ((match = newline.exec(markdown)) !== null) {
    ranges.push({
      from: start,
      contentTo: match.index,
      to: match.index + match[0].length,
    });
    start = match.index + match[0].length;
  }
  if (start < markdown.length) {
    ranges.push({ from: start, contentTo: markdown.length, to: markdown.length });
  }
  return ranges;
}

function sectionNameForOffset(markdown: string, ranges: readonly LineRange[], offset: number): string {
  let sectionName = '';
  for (const line of ranges) {
    if (line.from > offset) break;
    const text = markdown.slice(line.from, line.contentTo);
    const h2 = text.match(/^##\s+(.+?)\s*$/);
    if (h2) sectionName = h2[1].trim();
  }
  return sectionName;
}

export function buildSelectionScope(
  markdown: string,
  selectionFrom: number,
  selectionTo: number,
): SelectionReviseScope | null {
  const from = clamp(Math.min(selectionFrom, selectionTo), 0, markdown.length);
  const to = clamp(Math.max(selectionFrom, selectionTo), 0, markdown.length);
  if (from === to) return null;

  const excerpt = markdown.slice(from, to);
  if (excerpt.trim().length === 0) return null;

  const ranges = lineRanges(markdown);
  return {
    kind: 'selection',
    from,
    to,
    excerpt,
    sectionName: sectionNameForOffset(markdown, ranges, from),
  };
}

export function replaceMarkdownRange(
  markdown: string,
  range: MarkdownRange,
  replacementMarkdown: string,
): string {
  const from = clamp(range.from, 0, markdown.length);
  const to = clamp(range.to, from, markdown.length);
  return `${markdown.slice(0, from)}${replacementMarkdown}${markdown.slice(to)}`;
}
