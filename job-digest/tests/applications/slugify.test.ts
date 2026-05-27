import { describe, it, expect } from 'vitest';
import { slugify, isSlug } from '../../core/applications/slugify.js';

describe('slugify', () => {
  it('lowercases all characters', () => {
    expect(slugify('DoorDash')).toBe('doordash');
  });

  it('replaces non-alphanumerics with single dashes', () => {
    expect(slugify('Software Engineer I')).toBe('software-engineer-i');
    expect(slugify('A.I. Engineer')).toBe('a-i-engineer');
    expect(slugify('Senior / Staff Engineer')).toBe('senior-staff-engineer');
  });

  it('collapses runs of separators', () => {
    expect(slugify('foo   bar')).toBe('foo-bar');
    expect(slugify('foo___bar')).toBe('foo-bar');
    expect(slugify('foo - bar')).toBe('foo-bar');
  });

  it('strips leading and trailing separators', () => {
    expect(slugify('  spaced  ')).toBe('spaced');
    expect(slugify('--leading')).toBe('leading');
    expect(slugify('trailing--')).toBe('trailing');
    expect(slugify('!!a!!')).toBe('a');
  });

  it('returns empty string for all-non-alphanumeric input', () => {
    expect(slugify('!!!')).toBe('');
    expect(slugify('   ')).toBe('');
  });

  it('preserves digits', () => {
    expect(slugify('Web3 Developer')).toBe('web3-developer');
    expect(slugify('123-abc')).toBe('123-abc');
  });

  it('handles unicode by stripping non-ASCII', () => {
    expect(slugify('Engineer (Café)')).toBe('engineer-caf');
  });

  it('isSlug returns true for well-formed slugs', () => {
    expect(isSlug('doordash')).toBe(true);
    expect(isSlug('software-engineer-i')).toBe(true);
    expect(isSlug('a1-b2')).toBe(true);
  });

  it('isSlug returns false for malformed strings', () => {
    expect(isSlug('')).toBe(false);
    expect(isSlug('-leading')).toBe(false);
    expect(isSlug('trailing-')).toBe(false);
    expect(isSlug('foo--bar')).toBe(false);
    expect(isSlug('Foo')).toBe(false);
    expect(isSlug('foo bar')).toBe(false);
  });
});
