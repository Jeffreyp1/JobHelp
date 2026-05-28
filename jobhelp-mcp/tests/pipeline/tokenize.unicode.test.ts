import { describe, it, expect } from 'vitest';
import { tokenize } from '../../core/pipeline/tokenize.js';

describe('tokenize — unicode and non-ASCII inputs', () => {
  it('preserves CJK / Cyrillic / Arabic word characters alongside ASCII', () => {
    const toks = tokenize('Senior Engineer 工程师 Инженер مهندس');
    expect(toks).toContain('senior');
    expect(toks).toContain('engineer');
    expect(toks).toContain('工程师');
    expect(toks).toContain('инженер');
    expect(toks).toContain('مهندس');
  });

  it('emoji are not splitters but are emitted as their own tokens (length >= 2 in UTF-16)', () => {
    const toks = tokenize('backend 🚀 engineer');
    expect(toks).toContain('backend');
    expect(toks).toContain('engineer');
    expect(toks.length).toBe(3);
  });

  it('combining diacritics: accented characters are preserved as part of the token', () => {
    const toks = tokenize('naïve résumé');
    expect(toks).toEqual(['naïve', 'résumé']);
  });

  it('zero-width joiner inside a single string does not crash', () => {
    expect(() => tokenize('engineer‍polyglot')).not.toThrow();
  });

  it('mixed-script + punctuation: tokens split on ASCII punctuation but Unicode letters survive', () => {
    const toks = tokenize('Senior;Engineer,工程师');
    expect(toks).toContain('senior');
    expect(toks).toContain('engineer');
    expect(toks).toContain('工程师');
  });

  it('Unicode line separators behave like whitespace', () => {
    const toks = tokenize('alpha\nbeta\tgamma');
    expect(toks).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('lowercases ASCII consistently regardless of source script context', () => {
    const toks = tokenize('GoLang JS Postgres');
    expect(toks).toEqual(['golang', 'js', 'postgres']);
  });
});
