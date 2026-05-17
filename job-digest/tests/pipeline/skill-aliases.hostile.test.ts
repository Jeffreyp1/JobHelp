import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  buildAliasMap,
  canonicalize,
  canonicalizeAll,
} from '../../core/pipeline/skill-aliases.js';
import { tokenize } from '../../core/pipeline/tokenize.js';
import { __resetForTests, getRecentLogs } from '../../core/lib/log.js';

beforeEach(() => __resetForTests());
afterEach(() => __resetForTests());

describe('skill-aliases — hostile / edge inputs', () => {
  it('canonicalize("") returns ""', () => {
    const map = buildAliasMap();
    expect(canonicalize('', map)).toBe('');
  });

  it('canonicalize on UPPERCASE unknown token returns lowercase passthrough', () => {
    const map = buildAliasMap();
    expect(canonicalize('UNKNOWN_TERM', map)).toBe('unknown_term');
  });

  it('canonicalize on whitespace-only string returns lowercase passthrough (no crash)', () => {
    const map = buildAliasMap();
    // canonicalize returns token.toLowerCase() on unknown lookup, so whitespace is preserved.
    expect(canonicalize('   ', map)).toBe('   ');
  });

  it('canonicalizeAll on [] returns []', () => {
    const map = buildAliasMap();
    expect(canonicalizeAll([], map)).toEqual([]);
  });

  it('canonicalizeAll dedupes duplicate alias forms to a single canonical', () => {
    const map = buildAliasMap();
    const out = canonicalizeAll(['k8s', 'k8s', 'kubernetes'], map);
    expect(out).toEqual(['kubernetes']);
  });

  it('canonicalizeAll preserves empty strings as their own (empty) canonical', () => {
    const map = buildAliasMap();
    expect(canonicalizeAll(['', 'k8s', ''], map)).toEqual(['', 'kubernetes']);
  });

  it('canonicalize on phrases with mixed whitespace and underscores hits the lookup key', () => {
    const map = buildAliasMap();
    expect(canonicalize('amazon_web_services', map)).toBe('amazon web services');
    expect(canonicalize('amazon web services', map)).toBe('amazon web services');
    expect(canonicalize('amazon  web  services', map)).toBe('amazon web services');
  });

  it('multiWordPhrases registered in the alias map can be fed back into tokenize without crashing', () => {
    const map = buildAliasMap();
    for (const phrase of map.multiWordPhrases) {
      expect(() => tokenize('test text containing ' + phrase, [phrase])).not.toThrow();
    }
  });

  it('regex-special phrases like "c++" and ".net" are tokenized via the domain-token pass, not as multi-word phrases', () => {
    const map = buildAliasMap();
    expect(map.multiWordPhrases).not.toContain('c++');
    expect(map.multiWordPhrases).not.toContain('.net');
  });

  it('buildAliasMap is idempotent (two calls yield equivalent maps)', () => {
    const a = buildAliasMap();
    const b = buildAliasMap();
    expect(a.canonical.size).toBe(b.canonical.size);
    expect(a.multiWordPhrases.length).toBe(b.multiWordPhrases.length);
    for (const [k, v] of a.canonical) {
      expect(b.canonical.get(k)).toBe(v);
    }
    for (const p of a.multiWordPhrases) {
      expect(b.multiWordPhrases).toContain(p);
    }
  });

  it('every multi-word phrase in the map has no leading/trailing whitespace', () => {
    const map = buildAliasMap();
    for (const p of map.multiWordPhrases) {
      expect(p).toBe(p.trim());
      expect(p.length).toBeGreaterThan(0);
    }
  });

  it('every canonical entry in the map has a non-empty value', () => {
    const map = buildAliasMap();
    for (const v of map.canonical.values()) {
      expect(v.length).toBeGreaterThan(0);
    }
  });

  it('every canonical key is collision-free vs an unrelated variant of another canonical', () => {
    const map = buildAliasMap();
    // No two canonicals map to the same key
    const keys = new Set<string>();
    for (const k of map.canonical.keys()) {
      expect(keys.has(k)).toBe(false);
      keys.add(k);
    }
  });

  it('canonicalize on a known alias is case-insensitive', () => {
    const map = buildAliasMap();
    expect(canonicalize('K8S', map)).toBe('kubernetes');
    expect(canonicalize('Kubernetes', map)).toBe('kubernetes');
    expect(canonicalize('kuBERnetes', map)).toBe('kubernetes');
  });

  it('canonicalizeAll preserves order of first-seen canonicals', () => {
    const map = buildAliasMap();
    const out = canonicalizeAll(['k8s', 'js', 'kubernetes', 'javascript'], map);
    expect(out.length).toBe(2);
    expect(out[0]).toBe('kubernetes');
    expect(out[1]).toBe('javascript');
  });

  it('alias map handles aliases that themselves look like regex metachars after escapeRegExp', () => {
    const map = buildAliasMap();
    // "node.js", "next.js" — both should canonicalize correctly
    expect(canonicalize('node.js', map)).toBe('node.js');
    expect(canonicalize('next.js', map)).toBe('next.js');
    expect(canonicalize('c++', map)).toBe('c++');
    expect(canonicalize('c#', map)).toBe('c#');
  });

  it('emits skill_aliases.skipped_empty_canonical when canonical key is empty', () => {
    const synthetic: Record<string, readonly string[]> = { '': ['k8s'], 'kubernetes': ['k8s'] };
    buildAliasMap(synthetic);
    const warns = getRecentLogs().filter(l => l.msg === 'skill_aliases.skipped_empty_canonical');
    expect(warns.length).toBeGreaterThan(0);
    const first = warns[0];
    expect(first).toBeDefined();
    expect(first?.ctx).toMatchObject({ rawCanon: '' });
  });

  it('emits skill_aliases.skipped_empty_variant when a variant string is empty', () => {
    const synthetic: Record<string, readonly string[]> = { 'kubernetes': ['k8s', '', 'kube'] };
    buildAliasMap(synthetic);
    const warns = getRecentLogs().filter(l => l.msg === 'skill_aliases.skipped_empty_variant');
    expect(warns.length).toBeGreaterThan(0);
    const first = warns[0];
    expect(first).toBeDefined();
    expect(first?.ctx).toMatchObject({ canonical: 'kubernetes' });
  });
});
