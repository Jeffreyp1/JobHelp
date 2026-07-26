import { describe, expect, it } from 'vitest';
import { buildSemanticQueryText } from '../../core/pipeline/semanticQuery.js';
import type { ProfileConfig, Seniority } from '../../core/types/config.js';

function profile(overrides: Partial<ProfileConfig> = {}): ProfileConfig {
  return {
    resumeDumpPath: '/tmp/r.md',
    skills: ['TypeScript', 'Python', 'React'],
    location: 'Austin, TX',
    remoteOk: true,
    salaryFloor: 1,
    seniority: 'entry',
    roleFamily: ['ml', 'backend', 'fullstack', 'devops'],
    ...overrides,
  };
}

describe('buildSemanticQueryText', () => {
  it('returns empty string when skills and roleFamily are both empty', () => {
    expect(buildSemanticQueryText(profile({ skills: [], roleFamily: [] }))).toBe('');
  });

  it('composes the full example paragraph', () => {
    expect(buildSemanticQueryText(profile())).toBe(
      'Entry-level or new graduate software engineer seeking machine learning and AI, backend, full-stack, or devops and infrastructure roles. Skilled in TypeScript, Python, and React. Based in Austin, TX; open to remote work.',
    );
  });

  it('includes every skill', () => {
    const skills = ['Rust', 'Kubernetes', 'PostgreSQL', 'GraphQL'];
    const text = buildSemanticQueryText(profile({ skills }));
    for (const skill of skills) expect(text).toContain(skill);
  });

  it('maps each seniority to its phrase', () => {
    const cases: Record<Seniority, string> = {
      intern: 'Internship',
      entry: 'Entry-level or new graduate',
      mid: 'Mid-level',
      senior: 'Senior',
      staff: 'Staff-level',
    };
    for (const [seniority, phrase] of Object.entries(cases) as [Seniority, string][]) {
      const text = buildSemanticQueryText(profile({ seniority }));
      expect(text.startsWith(`${phrase} software engineer`)).toBe(true);
    }
  });

  it('maps each known roleFamily to its human phrase', () => {
    const cases: Record<string, string> = {
      ml: 'machine learning and AI',
      backend: 'backend',
      fullstack: 'full-stack',
      devops: 'devops and infrastructure',
      frontend: 'frontend',
      sre: 'site reliability',
      data: 'data engineering',
      mobile: 'mobile',
      security: 'security',
    };
    for (const [family, phrase] of Object.entries(cases)) {
      expect(buildSemanticQueryText(profile({ roleFamily: [family] }))).toContain(
        `seeking ${phrase} roles.`,
      );
    }
  });

  it('passes unknown role families through as-is', () => {
    const text = buildSemanticQueryText(profile({ roleFamily: ['ai-engineer', 'platform'] }));
    expect(text).toContain('seeking ai-engineer or platform roles.');
  });

  it('handles a single skill and no roleFamily', () => {
    const text = buildSemanticQueryText(profile({ skills: ['Go'], roleFamily: [] }));
    expect(text).toBe(
      'Entry-level or new graduate software engineer. Skilled in Go. Based in Austin, TX; open to remote work.',
    );
  });

  it('joins two skills with and', () => {
    expect(buildSemanticQueryText(profile({ skills: ['Go', 'Rust'] }))).toContain(
      'Skilled in Go and Rust.',
    );
  });

  it('says onsite or hybrid preferred when remoteOk is false', () => {
    expect(buildSemanticQueryText(profile({ remoteOk: false }))).toContain(
      'Based in Austin, TX; onsite or hybrid preferred.',
    );
  });

  it('omits the location sentence when location is empty', () => {
    const text = buildSemanticQueryText(profile({ location: '' }));
    expect(text).not.toContain('Based in');
    expect(text).toBe(text.trim());
  });

  it('never leaks undefined', () => {
    const variants = [
      profile(),
      profile({ skills: [], roleFamily: ['backend'] }),
      profile({ skills: ['Go'], roleFamily: [] }),
      profile({ location: '' }),
    ];
    for (const p of variants) expect(buildSemanticQueryText(p)).not.toContain('undefined');
  });

  it('is deterministic and has no leading or trailing whitespace', () => {
    const p = profile();
    const a = buildSemanticQueryText(p);
    const b = buildSemanticQueryText(p);
    expect(a).toBe(b);
    expect(a).toBe(a.trim());
    expect(a).not.toMatch(/\s{2,}/);
  });

  it('treats whitespace-only skills and roleFamily entries as empty', () => {
    expect(buildSemanticQueryText(profile({ skills: [' '], roleFamily: ['  '] }))).toBe('');
  });
});
