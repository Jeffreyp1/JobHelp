import { describe, it, expect } from 'vitest';
import { escapeRegExp } from '../../core/lib/regexp.js';

describe('escapeRegExp', () => {
  it('escapes regex metacharacters', () => {
    expect(escapeRegExp('a.b+c')).toBe('a\\.b\\+c');
    expect(escapeRegExp('(x|y)')).toBe('\\(x\\|y\\)');
    expect(escapeRegExp('[a-z]*')).toBe('\\[a-z\\]\\*');
    expect(escapeRegExp('plain')).toBe('plain');
  });
  it('handles empty string', () => {
    expect(escapeRegExp('')).toBe('');
  });
});
