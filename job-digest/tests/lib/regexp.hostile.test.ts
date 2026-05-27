import { describe, it, expect } from 'vitest';
import { escapeRegExp } from '../../core/lib/regexp.js';

describe('escapeRegExp — hostile / boundary inputs', () => {
  it('single space remains a single space (whitespace not a metachar)', () => {
    expect(escapeRegExp(' ')).toBe(' ');
  });

  it('escapes every regex special character correctly', () => {
    // List from MDN: . * + ? ^ $ { } ( ) | [ ] \
    const input = '.*+?^${}()|[]\\';
    const escaped = escapeRegExp(input);
    for (const ch of input) {
      expect(escaped).toContain('\\' + ch);
    }
  });

  it('long alphanumeric string is unchanged', () => {
    const input = 'a'.repeat(10000);
    expect(escapeRegExp(input)).toBe(input);
    expect(escapeRegExp(input).length).toBe(10000);
  });

  it('the escaped output, when compiled as a regex, matches the original literally', () => {
    const cases = ['hello.world', 'a+b*c?d', '(x|y)', '[a-z]*', '$5.99', 'path\\to\\file'];
    for (const s of cases) {
      const re = new RegExp('^' + escapeRegExp(s) + '$');
      expect(re.test(s)).toBe(true);
    }
  });

  it('escape is a no-op on non-meta ASCII characters', () => {
    expect(escapeRegExp('abc123_-:;')).toBe('abc123_-:;');
  });

  it('escapes unicode metachar safely (forward slash, hash unchanged)', () => {
    expect(escapeRegExp('node/modules')).toBe('node/modules');
    expect(escapeRegExp('c#')).toBe('c#');
  });

  it('does not throw on extremely long input mixed with metachars', () => {
    const input = 'a.b*c?'.repeat(1000);
    expect(() => escapeRegExp(input)).not.toThrow();
    const out = escapeRegExp(input);
    expect(out.length).toBeGreaterThan(input.length);
  });
});
