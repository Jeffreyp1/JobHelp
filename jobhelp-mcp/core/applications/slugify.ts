const NON_ALPHANUMERIC_RE = /[^a-z0-9]+/g;
const LEADING_TRAILING_DASH_RE = /^-+|-+$/g;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(NON_ALPHANUMERIC_RE, '-')
    .replace(LEADING_TRAILING_DASH_RE, '');
}

export function isSlug(s: string): boolean {
  return SLUG_RE.test(s);
}
