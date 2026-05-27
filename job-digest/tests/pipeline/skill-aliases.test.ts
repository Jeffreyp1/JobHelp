import { describe, it, expect } from 'vitest';
import {
  buildAliasMap,
  canonicalize,
  canonicalizeAll,
} from '../../core/pipeline/skill-aliases.js';

describe('skill-aliases', () => {
  it('canonicalize("k8s") === "kubernetes"', () => {
    const map = buildAliasMap();
    expect(canonicalize('k8s', map)).toBe('kubernetes');
  });

  it('canonicalize("Go", map) === "go" (case insensitive)', () => {
    const map = buildAliasMap();
    expect(canonicalize('Go', map)).toBe('go');
    expect(canonicalize('Golang', map)).toBe('go');
  });

  it('unknown tokens pass through, lowercased', () => {
    const map = buildAliasMap();
    expect(canonicalize('totallyNotInMap', map)).toBe('totallynotinmap');
  });

  it('canonicalizeAll dedupes the canonical result set', () => {
    const map = buildAliasMap();
    const out = canonicalizeAll(['k8s', 'kubernetes', 'js', 'javascript'], map);
    expect(out.length).toBe(2);
    expect(out).toContain('kubernetes');
    expect(out).toContain('javascript');
  });

  it('multi-word phrases registered (e.g. "amazon web services")', () => {
    const map = buildAliasMap();
    expect(map.multiWordPhrases).toContain('amazon web services');
    expect(map.multiWordPhrases).toContain('google cloud platform');
  });

  it('alias map size is at least 70 entries (canonical + variants)', () => {
    const map = buildAliasMap();
    expect(map.canonical.size).toBeGreaterThanOrEqual(70);
  });

  it('canonicalize works for post-tokenize forms with `_` separators', () => {
    const map = buildAliasMap();
    expect(canonicalize('amazon_web_services', map)).toBe('amazon web services');
    expect(canonicalize('google_cloud_platform', map)).toBe('google cloud platform');
  });

  it('includes 2026-era framework aliases', () => {
    const map = buildAliasMap();
    expect(map.canonical.get('nestjs')).toBe('nestjs');
    expect(map.canonical.get('nest.js')).toBe('nestjs');
    expect(map.canonical.get('remix')).toBe('remix');
    expect(map.canonical.get('nuxt')).toBe('nuxt.js');
    expect(map.canonical.get('solidjs')).toBe('solid.js');
    expect(map.canonical.get('actix-web')).toBe('actix');
    expect(map.canonical.get('gin-gonic')).toBe('gin');
    expect(map.canonical.get('podman')).toBe('podman');
  });
});
