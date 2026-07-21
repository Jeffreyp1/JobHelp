import { describe, it, expect, beforeEach } from 'vitest';
import { validateConfig } from '../../core/lib/config-validation.js';
import { getRecentLogs, __resetForTests } from '../../core/lib/log.js';

function rawConfig(profileOverrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    profile: {
      resumeDumpPath: '/tmp/r.md',
      skills: ['ts'],
      location: 'Remote',
      remoteOk: true,
      salaryFloor: 1,
      seniority: 'entry',
      roleFamily: ['backend'],
      ...profileOverrides,
    },
    ranking: { topN: 1, digestK: 1 },
    output: { dir: '/tmp' },
  };
}

function warnsWithMsg(msg: string): readonly Record<string, unknown>[] {
  return getRecentLogs()
    .filter((e) => e.level === 'warn' && e.msg === msg)
    .map((e) => e.ctx ?? {});
}

beforeEach(() => {
  __resetForTests();
});

describe('roleFamily normalization', () => {
  it('maps the live human-readable role names to classifier slugs', () => {
    const config = validateConfig(
      rawConfig({
        roleFamily: [
          'AI Engineer',
          'LLM Engineer',
          'Applied AI Engineer',
          'AI/ML Engineer',
          'Backend Engineer',
          'Software Engineer',
          'Distributed Systems Engineer',
          'Platform Engineer',
        ],
      }),
    );
    expect(config.profile.roleFamily).toEqual(['ml', 'backend', 'fullstack', 'devops']);
    expect(warnsWithMsg('config.role_family_unmapped')).toEqual([]);
  });

  it('passes through canonical slugs case-insensitively', () => {
    const config = validateConfig(
      rawConfig({ roleFamily: ['Backend', 'ml', 'Solutions-Architect'] }),
    );
    expect(config.profile.roleFamily).toEqual(['backend', 'ml', 'solutions-architect']);
  });

  it('dedupes values that map to the same slug', () => {
    const config = validateConfig(rawConfig({ roleFamily: ['Backend Engineer', 'backend'] }));
    expect(config.profile.roleFamily).toEqual(['backend']);
  });

  it('warns and drops unmappable values', () => {
    const config = validateConfig(
      rawConfig({ roleFamily: ['backend', 'Underwater Basket Weaver'] }),
    );
    expect(config.profile.roleFamily).toEqual(['backend']);
    const warns = warnsWithMsg('config.role_family_unmapped');
    expect(warns).toHaveLength(1);
    expect(warns[0]?.['unmapped']).toEqual(['Underwater Basket Weaver']);
  });

  it('keeps an empty roleFamily empty without warning', () => {
    const config = validateConfig(rawConfig({ roleFamily: [] }));
    expect(config.profile.roleFamily).toEqual([]);
    expect(warnsWithMsg('config.role_family_unmapped')).toEqual([]);
  });
});

describe('allowedCountries guard', () => {
  it('warns when location names a country but allowedCountries is absent', () => {
    validateConfig(rawConfig({ location: 'Austin, TX' }));
    const warns = warnsWithMsg('config.allowed_countries_missing');
    expect(warns).toHaveLength(1);
    expect(warns[0]?.['detectedCountry']).toBe('US');
    expect(warns[0]?.['location']).toBe('Austin, TX');
  });

  it('does not warn when allowedCountries is present', () => {
    validateConfig(rawConfig({ location: 'Austin, TX', allowedCountries: ['US'] }));
    expect(warnsWithMsg('config.allowed_countries_missing')).toEqual([]);
  });

  it('does not warn when location has no detectable country', () => {
    validateConfig(rawConfig({ location: 'Remote' }));
    expect(warnsWithMsg('config.allowed_countries_missing')).toEqual([]);
  });
});
