export function stripJsonFences(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

export function validateClaudePayload(p: {
  summary: unknown;
  keywords: unknown;
  sources: unknown;
}): string | null {
  if (typeof p.summary !== 'string' || p.summary.length === 0) {
    return 'summary must be a non-empty string';
  }
  if (!Array.isArray(p.keywords) || !p.keywords.every((k) => typeof k === 'string')) {
    return 'keywords must be an array of strings';
  }
  if (!Array.isArray(p.sources)) {
    return 'sources must be an array';
  }
  for (const s of p.sources) {
    if (
      typeof s !== 'object' ||
      s === null ||
      typeof (s as { title?: unknown }).title !== 'string' ||
      typeof (s as { url?: unknown }).url !== 'string'
    ) {
      return 'each source must have string title + url';
    }
  }
  return null;
}
