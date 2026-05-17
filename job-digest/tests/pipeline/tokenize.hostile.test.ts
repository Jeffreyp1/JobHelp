import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tokenize } from '../../core/pipeline/tokenize.js';
import { __resetForTests, getRecentLogs } from '../../core/lib/log.js';

beforeEach(() => __resetForTests());
afterEach(() => __resetForTests());

describe('tokenize — empty and whitespace inputs', () => {
  it('empty string returns []', () => {
    expect(tokenize('')).toEqual([]);
  });
  it('whitespace-only string returns []', () => {
    expect(tokenize('   \t\n')).toEqual([]);
  });
  it('punctuation-only string returns []', () => {
    expect(tokenize('!?,.;')).toEqual([]);
  });
});

describe('tokenize — long inputs and performance bounds', () => {
  it('5000-char "go "-pattern input produces ~1666 tokens in under 100ms', () => {
    const input = 'go '.repeat(Math.ceil(5000 / 3)).slice(0, 5000);
    const t0 = performance.now();
    const toks = tokenize(input);
    const t1 = performance.now();
    expect(toks.length).toBeGreaterThan(1000);
    expect(toks.length).toBeLessThan(2000);
    expect(toks.every((t) => t === 'go')).toBe(true);
    expect(t1 - t0).toBeLessThan(100);
  });

  it('100000-char input does not hang or throw', () => {
    const input = 'engineer python golang kubernetes '.repeat(3000);
    const t0 = performance.now();
    const toks = tokenize(input);
    const t1 = performance.now();
    expect(toks.length).toBeGreaterThan(0);
    expect(t1 - t0).toBeLessThan(500);
  });
});

describe('tokenize — domain-token edge cases', () => {
  it('c++ at start of string: tokenized', () => {
    expect(tokenize('c++ developer')).toContain('c++');
  });
  it('c++ at end of string: tokenized', () => {
    expect(tokenize('developer c++')).toContain('c++');
  });
  it('c++abc: c++ extracted via placeholder pre-pass, remaining "abc" is a separate token', () => {
    const toks = tokenize('c++abc');
    expect(toks).toContain('c++');
    expect(toks).toContain('abc');
  });
  it('.net token survives in start/middle/end of sentence', () => {
    expect(tokenize('.net is great')).toContain('.net');
    expect(tokenize('great with .net')).toContain('.net');
    expect(tokenize('works with .net.')).toContain('.net');
  });
  it('length-1 char dropped, length-2 domain token c# preserved', () => {
    expect(tokenize('a b c# de')).toContain('c#');
    expect(tokenize('a b c# de')).not.toContain('a');
    expect(tokenize('a b c# de')).not.toContain('b');
  });
  it('node.js domain token is preserved alongside non-domain tokens', () => {
    expect(tokenize('node.js backend')).toEqual(['node.js', 'backend']);
  });
  it('c++/cli is a recognized domain token', () => {
    const toks = tokenize('c++/cli developer');
    expect(toks).toContain('c++/cli');
  });
});

describe('tokenize — multi-word phrases with hostile inputs', () => {
  it('regex-special chars in phrases (".", "*", "$") do not throw and are treated literally', () => {
    expect(() => tokenize('a.b some text', ['a.b', 'x*y', '$dollar'])).not.toThrow();
    const toks = tokenize('a.b some text', ['a.b', 'x*y', '$dollar']);
    expect(toks).toContain('a.b');
  });

  it('star and plus regex metacharacters in phrases do not match literally as wildcards', () => {
    const toks = tokenize('xxxxx and yyy', ['x*y']);
    expect(toks).not.toContain('x*y');
    expect(toks).not.toContain('xxxxx_and_yyy');
  });

  it('overlapping phrase prefixes: the longer phrase listed first wins', () => {
    const toks = tokenize('amazon web services foo', [
      'amazon web services',
      'amazon web',
    ]);
    expect(toks).toContain('amazon_web_services');
    expect(toks).toContain('foo');
    expect(toks).not.toContain('amazon_web');
  });

  it('empty phrase list yields same result as omitted phrase list', () => {
    expect(tokenize('hello world', [])).toEqual(tokenize('hello world'));
  });

  it('phrase with leading/trailing whitespace is trimmed and still matches text', () => {
    const toks = tokenize('amazon web services foo', ['  amazon web services  ']);
    expect(toks).toContain('amazon_web_services');
  });

  it('empty-string phrase entry is skipped without crash', () => {
    expect(() => tokenize('hello world', [''])).not.toThrow();
    expect(tokenize('hello world', [''])).toEqual(['hello', 'world']);
  });

  it('whitespace-only phrase entry is skipped', () => {
    expect(() => tokenize('hello world', ['   '])).not.toThrow();
    expect(tokenize('hello world', ['   '])).toEqual(['hello', 'world']);
  });

  it('phrase containing only regex metachars is escaped, never compiles to dangerous regex', () => {
    expect(() => tokenize('foo (bar) baz', ['(bar)'])).not.toThrow();
    expect(() => tokenize('foo [bar] baz', ['[bar]'])).not.toThrow();
    expect(() => tokenize('foo \\bar baz', ['\\bar'])).not.toThrow();
  });

  it('phrase with case-mismatched input still matches (phrase lowercased internally)', () => {
    const toks = tokenize('Amazon Web Services foo', ['amazon web services']);
    expect(toks).toContain('amazon_web_services');
  });

  it('large list of multi-word phrases (200) is processed without throwing', () => {
    const phrases = Array.from({ length: 200 }, (_, i) => `phrase ${i}`);
    expect(() => tokenize('phrase 42 in the text', phrases)).not.toThrow();
  });

  it('all-metachar phrase "{nested}brace" is fully escaped, no throw, non-matching phrase leaves tokens intact', () => {
    const toks = tokenize('hello world', ['{nested}brace']);
    expect(toks).toEqual(['hello', 'world']);
  });
});

describe('tokenize — visibility / logging', () => {
  it('does NOT emit log.warn for normal multi-word phrases', () => {
    __resetForTests();
    tokenize('amazon web services', ['amazon web services']);
    const warns = getRecentLogs().filter((e) => e.level === 'warn');
    expect(warns.length).toBe(0);
  });
});
