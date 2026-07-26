import { describe, it, expect } from 'vitest';
import {
  identityKey,
  normalizeCompany,
  titleTokenSet,
  tokenSetsEqual,
  jaccard,
} from '../../core/pipeline/identity.js';

describe('identityKey', () => {
  it('is stable across case and punctuation variants of the same title', () => {
    expect(identityKey('Abnormal Security', 'AI Product Engineer')).toBe(
      identityKey('abnormalsecurity', 'ai   product engineer.'),
    );
  });

  it('is stable across title word-order variants (token-set based)', () => {
    expect(identityKey('Acme', 'Backend Engineer, Senior')).toBe(
      identityKey('Acme', 'Senior Backend Engineer'),
    );
  });

  it('differs for different roles at the same company', () => {
    expect(identityKey('Acme', 'Senior Backend Engineer')).not.toBe(
      identityKey('Acme', 'Staff Backend Engineer'),
    );
  });

  it('differs for the same role at different companies', () => {
    expect(identityKey('Acme', 'Software Engineer')).not.toBe(
      identityKey('Globex', 'Software Engineer'),
    );
  });

  it('sorts title tokens so ordering never leaks into the key', () => {
    expect(identityKey('Acme', 'alpha beta gamma')).toBe('acme alpha beta gamma');
  });
});

describe('re-exported identity helpers', () => {
  it('normalizeCompany strips case and non-alphanumerics', () => {
    expect(normalizeCompany('Abnormal Security, Inc.')).toBe('abnormalsecurityinc');
  });

  it('titleTokenSet is a set of normalized tokens', () => {
    expect([...titleTokenSet('Senior Backend Engineer')].sort()).toEqual([
      'backend',
      'engineer',
      'senior',
    ]);
  });

  it('tokenSetsEqual treats reordered token sets as equal but empty sets as unequal', () => {
    expect(tokenSetsEqual(titleTokenSet('aa bb'), titleTokenSet('bb aa'))).toBe(true);
    expect(tokenSetsEqual(titleTokenSet('!!'), titleTokenSet('??'))).toBe(false);
  });

  it('jaccard returns overlap ratio', () => {
    expect(jaccard(new Set(['a', 'b']), new Set(['b', 'c']))).toBeCloseTo(1 / 3, 10);
  });
});
