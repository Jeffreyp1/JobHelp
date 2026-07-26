import { describe, it, expect } from 'vitest';
import { filter } from '../../core/pipeline/filter.js';
import type { JobDigestConfig, NormalizedJob } from '../../core/types/index.js';

// Fixed reference date for all age-sensitive tests.
const NOW = new Date('2026-05-29T00:00:00Z');

function makeConfig(overrides: Partial<JobDigestConfig> = {}): JobDigestConfig {
  const base: JobDigestConfig = {
    profile: {
      resumeDumpPath: '/tmp/resume.md',
      skills: ['typescript', 'go'],
      location: 'Austin, TX',
      remoteOk: true,
      salaryFloor: 100000,
      seniority: 'mid',
      roleFamily: ['backend', 'fullstack'],
    },
    sources: {},
    ranking: {
      topN: 20,
      digestK: 10,
    },
    rules: { userRulesDir: '/tmp/rules-test', mode: 'additive' },
    output: { dir: '/tmp/digests' },
  };
  return { ...base, ...overrides };
}

// Must be >=200 chars after HTML strip so the ghost rule never fires.
const DEFAULT_DESCRIPTION =
  'We are looking for a software engineer to build distributed systems in Go and TypeScript. ' +
  'You will own services from design through deployment, work closely with product and infrastructure teams, ' +
  'and ship features that affect every customer. Strong fundamentals and a curious mindset are required.';

function makeJob(overrides: Partial<NormalizedJob> = {}): NormalizedJob {
  return {
    id: 'test:job1',
    source: 'test',
    url: 'https://example.com/job',
    title: 'Software Engineer',
    company: 'Acme',
    location: 'Austin, TX',
    remote: 'hybrid',
    description: DEFAULT_DESCRIPTION,
    ...overrides,
  };
}

// Helpers for configs with roleFamily disabled (so only the non-software gate can fire).
function noRoleFamilyConfig(overrides: Partial<JobDigestConfig> = {}): JobDigestConfig {
  const base = makeConfig(overrides);
  return { ...base, profile: { ...base.profile, roleFamily: [] } };
}

// Days offset relative to NOW (positive = days ago).
function daysAgo(n: number): string {
  return new Date(NOW.getTime() - n * 86_400_000).toISOString();
}

// ---------------------------------------------------------------------------
// Non-software ENGINEERING disciplines (not already in filter.test.ts)
// ---------------------------------------------------------------------------
describe('non-software engineering disciplines — drop', () => {
  const cfg = noRoleFamilyConfig();

  it('drops "Structural Engineer"', async () => {
    const out = await filter([makeJob({ title: 'Structural Engineer' })], cfg, NOW);
    expect(out).toHaveLength(0);
  });

  it('drops "Materials Engineer"', async () => {
    const out = await filter([makeJob({ title: 'Materials Engineer' })], cfg, NOW);
    expect(out).toHaveLength(0);
  });

  it('drops "Environmental Engineer"', async () => {
    const out = await filter([makeJob({ title: 'Environmental Engineer' })], cfg, NOW);
    expect(out).toHaveLength(0);
  });

  it('drops "Petroleum Engineer"', async () => {
    const out = await filter([makeJob({ title: 'Petroleum Engineer' })], cfg, NOW);
    expect(out).toHaveLength(0);
  });

  it('drops "Mining Engineer"', async () => {
    const out = await filter([makeJob({ title: 'Mining Engineer' })], cfg, NOW);
    expect(out).toHaveLength(0);
  });

  it('drops "Nuclear Engineer"', async () => {
    const out = await filter([makeJob({ title: 'Nuclear Engineer' })], cfg, NOW);
    expect(out).toHaveLength(0);
  });

  it('drops "Automotive Engineer"', async () => {
    const out = await filter([makeJob({ title: 'Automotive Engineer' })], cfg, NOW);
    expect(out).toHaveLength(0);
  });

  // "examining" contains "mining" as a substring — the regex uses \b so it must NOT match.
  it('does NOT drop a title containing "examining" (mining substring guard)', async () => {
    const out = await filter([makeJob({ title: 'Software Engineer, Examining Systems' })], cfg, NOW);
    expect(out).toHaveLength(1);
  });

  // Case-insensitivity check for engineering gate.
  it('drops "STRUCTURAL ENGINEER" (case-insensitive)', async () => {
    const out = await filter([makeJob({ title: 'STRUCTURAL ENGINEER' })], cfg, NOW);
    expect(out).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Non-software TRADES — drop
// ---------------------------------------------------------------------------
describe('non-software trades — drop', () => {
  const cfg = noRoleFamilyConfig();

  it('drops "Carpenter"', async () => {
    const out = await filter([makeJob({ title: 'Carpenter' })], cfg, NOW);
    expect(out).toHaveLength(0);
  });

  it('drops "Millwright"', async () => {
    const out = await filter([makeJob({ title: 'Millwright' })], cfg, NOW);
    expect(out).toHaveLength(0);
  });

  it('drops "Pipefitter"', async () => {
    const out = await filter([makeJob({ title: 'Pipefitter' })], cfg, NOW);
    expect(out).toHaveLength(0);
  });

  it('drops "Senior Carpenter" (trades with seniority prefix)', async () => {
    const out = await filter([makeJob({ title: 'Senior Carpenter' })], cfg, NOW);
    expect(out).toHaveLength(0);
  });

  it('drops "Lead Millwright" (trades with lead prefix)', async () => {
    const out = await filter([makeJob({ title: 'Lead Millwright' })], cfg, NOW);
    expect(out).toHaveLength(0);
  });

  it('drops "CARPENTER" (uppercase trade)', async () => {
    const out = await filter([makeJob({ title: 'CARPENTER' })], cfg, NOW);
    expect(out).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Recall guards: software roles that contain trade/engineering keywords survive
// ---------------------------------------------------------------------------
describe('non-software boundary — recall guards', () => {
  // roleFamily: [] so ONLY the non-software gate can drop.
  const cfg = noRoleFamilyConfig();

  it('keeps "Sales Engineer" (roleFamily=[]) — sales word alone does not trip trade gate', async () => {
    const out = await filter([makeJob({ title: 'Sales Engineer' })], cfg, NOW);
    expect(out).toHaveLength(1);
  });

  it('keeps "DevOps Engineer" (roleFamily=[]) — devops word alone does not trip non-software gate', async () => {
    const out = await filter([makeJob({ title: 'DevOps Engineer' })], cfg, NOW);
    expect(out).toHaveLength(1);
  });

  it('keeps "Aerospace Software Engineer" — discipline as modifier of software role', async () => {
    const out = await filter([makeJob({ title: 'Aerospace Software Engineer' })], cfg, NOW);
    expect(out).toHaveLength(1);
  });

  it('keeps "Automotive Software Developer" — discipline as modifier of software role', async () => {
    const out = await filter([makeJob({ title: 'Automotive Software Developer' })], cfg, NOW);
    expect(out).toHaveLength(1);
  });

  it('drops "Hardware Engineer" — no software modifier present', async () => {
    const out = await filter([makeJob({ title: 'Hardware Engineer' })], cfg, NOW);
    expect(out).toHaveLength(0);
  });

  it('keeps "Hardware Software Engineer" — software modifier saves it', async () => {
    const out = await filter([makeJob({ title: 'Hardware Software Engineer' })], cfg, NOW);
    expect(out).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Healthcare — NEW variants not in filter.test.ts
// ---------------------------------------------------------------------------
describe('non-software healthcare — drop (roleFamily=[])', () => {
  const cfg = noRoleFamilyConfig();

  it('drops "Pharmacist"', async () => {
    const out = await filter(
      [makeJob({ title: 'Pharmacist', description: DEFAULT_DESCRIPTION })],
      cfg,
      NOW,
    );
    expect(out).toHaveLength(0);
  });

  it('drops "Therapist"', async () => {
    const out = await filter(
      [makeJob({ title: 'Therapist', description: DEFAULT_DESCRIPTION })],
      cfg,
      NOW,
    );
    expect(out).toHaveLength(0);
  });

  it('drops "Dentist"', async () => {
    const out = await filter(
      [makeJob({ title: 'Dentist', description: DEFAULT_DESCRIPTION })],
      cfg,
      NOW,
    );
    expect(out).toHaveLength(0);
  });

  it('drops "LPN" (Licensed Practical Nurse)', async () => {
    const out = await filter(
      [makeJob({ title: 'LPN', description: DEFAULT_DESCRIPTION })],
      cfg,
      NOW,
    );
    expect(out).toHaveLength(0);
  });

  it('drops "Medical Assistant"', async () => {
    const out = await filter(
      [makeJob({ title: 'Medical Assistant', description: DEFAULT_DESCRIPTION })],
      cfg,
      NOW,
    );
    expect(out).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Salary boundary tests
// ---------------------------------------------------------------------------
describe('salary boundary', () => {
  // salaryFloor is 100000 in base config.

  it('keeps job where salaryMax is exactly at salaryFloor (floor is inclusive)', async () => {
    const out = await filter([makeJob({ salaryMax: 100000 })], makeConfig(), NOW);
    expect(out).toHaveLength(1);
  });

  it('drops job where salaryMax is one dollar below salaryFloor', async () => {
    const out = await filter([makeJob({ salaryMax: 99999 })], makeConfig(), NOW);
    expect(out).toHaveLength(0);
  });

  it('keeps job where salaryMax is missing (missing data never drops)', async () => {
    const out = await filter([makeJob()], makeConfig(), NOW);
    expect(out).toHaveLength(1);
  });

  // dropsForSalary only checks salaryMax; a job with salaryMin but no salaryMax should be kept.
  it('keeps job where salaryMin is present but salaryMax is absent', async () => {
    const out = await filter([makeJob({ salaryMin: 50000 })], makeConfig(), NOW);
    expect(out).toHaveLength(1);
  });

  it('drops job where salaryMax is zero (below any positive floor)', async () => {
    const out = await filter([makeJob({ salaryMax: 0 })], makeConfig(), NOW);
    expect(out).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// maxAge boundary tests
// ---------------------------------------------------------------------------
describe('maxAge boundary', () => {
  const maxAgeCfg = (days: number, requireDate: boolean, enabled = true): JobDigestConfig =>
    makeConfig({
      ranking: {
        topN: 20,
        digestK: 10,
        maxAge: { enabled, days, requireDate },
      },
    });

  it('keeps job posted exactly on the cutoff day (boundary is strict >)', async () => {
    // postedAt = exactly 7 days ago, maxAge.days = 7 → ageDays === 7.0 → NOT > 7 → kept
    const cfg = maxAgeCfg(7, false);
    const out = await filter([makeJob({ postedAt: daysAgo(7) })], cfg, NOW);
    expect(out).toHaveLength(1);
  });

  it('drops job posted one day past the cutoff', async () => {
    const cfg = maxAgeCfg(7, false);
    const out = await filter([makeJob({ postedAt: daysAgo(8) })], cfg, NOW);
    expect(out).toHaveLength(0);
  });

  it('keeps undated job when requireDate=false (missing data never drops)', async () => {
    const cfg = maxAgeCfg(7, false);
    const out = await filter([makeJob()], cfg, NOW);
    expect(out).toHaveLength(1);
  });

  it('drops undated job when requireDate=true', async () => {
    const cfg = maxAgeCfg(7, true);
    const out = await filter([makeJob()], cfg, NOW);
    expect(out).toHaveLength(0);
  });

  it('keeps job with unparseable postedAt and requireDate=false', async () => {
    // dropForAge: unparseable → returns cfg.requireDate; requireDate=false → false → kept
    const cfg = maxAgeCfg(7, false);
    const out = await filter([makeJob({ postedAt: 'not-a-date' })], cfg, NOW);
    expect(out).toHaveLength(1);
  });

  it('drops job with unparseable postedAt and requireDate=true', async () => {
    // FLAG: unparseable postedAt with requireDate=true drops the job — characterizing real behavior.
    const cfg = maxAgeCfg(7, true);
    const out = await filter([makeJob({ postedAt: 'not-a-date' })], cfg, NOW);
    expect(out).toHaveLength(0);
  });

  it('keeps all jobs when maxAge is absent from config', async () => {
    const cfg = makeConfig({ ranking: { topN: 20, digestK: 10 } });
    const out = await filter([makeJob({ postedAt: daysAgo(365) })], cfg, NOW);
    expect(out).toHaveLength(1);
  });

  it('keeps job with empty-string postedAt and requireDate=false', async () => {
    // Empty string is treated as absent in dropForAge.
    const cfg = maxAgeCfg(7, false);
    const out = await filter([makeJob({ postedAt: '' })], cfg, NOW);
    expect(out).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Seniority distance — new combinations not in filter.test.ts
// ---------------------------------------------------------------------------
describe('seniority distance', () => {
  // intern=0, entry=1, mid=2, senior=3, staff=4
  // Distance >=2 → drop.

  function cfgFor(seniority: 'intern' | 'entry' | 'mid' | 'senior' | 'staff'): JobDigestConfig {
    return makeConfig({ profile: { ...makeConfig().profile, seniority, roleFamily: [] } });
  }

  it('drops intern-profile vs mid posting (distance=2)', async () => {
    // Title "Software Engineer II" signals mid.
    const out = await filter(
      [makeJob({ title: 'Software Engineer II' })],
      cfgFor('intern'),
      NOW,
    );
    expect(out).toHaveLength(0);
  });

  it('drops mid-profile vs staff posting (distance=2)', async () => {
    const out = await filter([makeJob({ title: 'Staff Engineer' })], cfgFor('mid'), NOW);
    expect(out).toHaveLength(0);
  });

  it('keeps mid-profile vs senior posting (distance=1)', async () => {
    const out = await filter([makeJob({ title: 'Senior Software Engineer' })], cfgFor('mid'), NOW);
    expect(out).toHaveLength(1);
  });

  it('keeps senior-profile vs mid posting (distance=1)', async () => {
    // Title with no seniority keyword → no signal → kept by missing-data rule.
    // Use "Engineer II" explicitly for a mid signal.
    const out = await filter([makeJob({ title: 'Engineer II' })], cfgFor('senior'), NOW);
    expect(out).toHaveLength(1);
  });

  it('drops entry-profile vs senior posting (distance=2)', async () => {
    const out = await filter([makeJob({ title: 'Senior Engineer' })], cfgFor('entry'), NOW);
    expect(out).toHaveLength(0);
  });

  // "Engineer II" is ambiguous early-career, so it is kept and demoted in ranking;
  // III/IV remain unambiguous mid+ signals and still drop via dropsForEngineerLevel.
  it('entry-profile vs Engineer II posting is kept (demote-dont-drop)', async () => {
    const out = await filter([makeJob({ title: 'Engineer II' })], cfgFor('entry'), NOW);
    expect(out).toHaveLength(1);
  });

  it('entry-profile vs Engineer III posting drops (dropsForEngineerLevel)', async () => {
    const out = await filter([makeJob({ title: 'Engineer III' })], cfgFor('entry'), NOW);
    expect(out).toHaveLength(0);
  });

  it('keeps mid-profile vs entry posting (distance=1, no engineer-level rule fires)', async () => {
    // Use a junior title that signals entry but does not trigger the engineer-level RE.
    const out = await filter([makeJob({ title: 'Junior Software Engineer' })], cfgFor('mid'), NOW);
    expect(out).toHaveLength(1);
  });

  it('drops staff-profile vs intern posting (distance=4)', async () => {
    // dropsForInternMismatch fires first (non-intern profile + intern title).
    const out = await filter(
      [makeJob({ title: 'Software Engineer Intern' })],
      cfgFor('staff'),
      NOW,
    );
    expect(out).toHaveLength(0);
  });

  it('keeps posting with no seniority signal for any profile (missing data never drops)', async () => {
    // Generic title with no level keywords → undefined signal → kept.
    const out = await filter(
      [makeJob({ title: 'Software Engineer' })],
      cfgFor('entry'),
      NOW,
    );
    expect(out).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Role-family: ML / data / security / sre / devops / mobile / designer / pm
// ---------------------------------------------------------------------------
describe('role-family filter — drop and keep', () => {
  const backendOnly = makeConfig({
    profile: { ...makeConfig().profile, roleFamily: ['backend'] },
  });

  it('drops "Data Scientist" for backend-only profile', async () => {
    const out = await filter([makeJob({ title: 'Data Scientist' })], backendOnly, NOW);
    expect(out).toHaveLength(0);
  });

  it('drops "Machine Learning Engineer" for backend-only profile', async () => {
    const out = await filter([makeJob({ title: 'Machine Learning Engineer' })], backendOnly, NOW);
    expect(out).toHaveLength(0);
  });

  it('drops "Security Engineer" for backend-only profile', async () => {
    const out = await filter([makeJob({ title: 'Security Engineer' })], backendOnly, NOW);
    expect(out).toHaveLength(0);
  });

  it('drops "Site Reliability Engineer" for backend-only profile', async () => {
    const out = await filter(
      [makeJob({ title: 'Site Reliability Engineer' })],
      backendOnly,
      NOW,
    );
    expect(out).toHaveLength(0);
  });

  it('drops "iOS Engineer" for backend-only profile', async () => {
    const out = await filter([makeJob({ title: 'iOS Engineer' })], backendOnly, NOW);
    expect(out).toHaveLength(0);
  });

  it('drops "Product Designer" for backend-only profile', async () => {
    const out = await filter([makeJob({ title: 'Product Designer' })], backendOnly, NOW);
    expect(out).toHaveLength(0);
  });

  it('keeps "Machine Learning Engineer" when ml is in roleFamily', async () => {
    const cfg = makeConfig({
      profile: { ...makeConfig().profile, roleFamily: ['backend', 'ml'] },
    });
    const out = await filter([makeJob({ title: 'Machine Learning Engineer' })], cfg, NOW);
    expect(out).toHaveLength(1);
  });

  it('keeps "Site Reliability Engineer" when sre is in roleFamily', async () => {
    const cfg = makeConfig({
      profile: { ...makeConfig().profile, roleFamily: ['backend', 'sre'] },
    });
    const out = await filter([makeJob({ title: 'Site Reliability Engineer' })], cfg, NOW);
    expect(out).toHaveLength(1);
  });

  it('drops "Platform Engineer" for backend-only profile (maps to devops)', async () => {
    const out = await filter([makeJob({ title: 'Platform Engineer' })], backendOnly, NOW);
    expect(out).toHaveLength(0);
  });

  it('keeps "Platform Engineer" when devops is in roleFamily', async () => {
    const cfg = makeConfig({
      profile: { ...makeConfig().profile, roleFamily: ['backend', 'devops'] },
    });
    const out = await filter([makeJob({ title: 'Platform Engineer' })], cfg, NOW);
    expect(out).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Remote / country filter
// ---------------------------------------------------------------------------
describe('remote and country filter', () => {
  it('drops remote job when remoteOk=false', async () => {
    const cfg = makeConfig({ profile: { ...makeConfig().profile, remoteOk: false } });
    const out = await filter([makeJob({ remote: 'remote' })], cfg, NOW);
    expect(out).toHaveLength(0);
  });

  it('keeps hybrid job when remoteOk=false', async () => {
    const cfg = makeConfig({ profile: { ...makeConfig().profile, remoteOk: false } });
    const out = await filter([makeJob({ remote: 'hybrid' })], cfg, NOW);
    expect(out).toHaveLength(1);
  });

  it('drops job in excluded country (Germany not in allowedCountries)', async () => {
    const cfg = makeConfig({
      profile: { ...makeConfig().profile, allowedCountries: ['US', 'Canada'], roleFamily: [] },
    });
    const out = await filter([makeJob({ location: 'Berlin, Germany' })], cfg, NOW);
    expect(out).toHaveLength(0);
  });

  it('keeps job in allowed country (UK is in allowedCountries)', async () => {
    const cfg = makeConfig({
      profile: { ...makeConfig().profile, allowedCountries: ['US', 'UK'], roleFamily: [] },
    });
    const out = await filter([makeJob({ location: 'London, UK' })], cfg, NOW);
    expect(out).toHaveLength(1);
  });

  it('keeps job with undetected location when allowedCountries is set (bare "Remote" survives)', async () => {
    const cfg = makeConfig({
      profile: { ...makeConfig().profile, allowedCountries: ['US'], roleFamily: [] },
    });
    const out = await filter([makeJob({ location: 'Remote' })], cfg, NOW);
    expect(out).toHaveLength(1);
  });

  it('keeps job when allowedCountries is empty (filter is off)', async () => {
    const cfg = makeConfig({
      profile: {
        ...makeConfig().profile,
        allowedCountries: [],
        roleFamily: [],
      },
    });
    const out = await filter([makeJob({ location: 'Tokyo, Japan' })], cfg, NOW);
    expect(out).toHaveLength(1);
  });

  it('drops job in India when allowedCountries excludes India', async () => {
    const cfg = makeConfig({
      profile: { ...makeConfig().profile, allowedCountries: ['US', 'Canada'], roleFamily: [] },
    });
    const out = await filter([makeJob({ location: 'Bangalore, India' })], cfg, NOW);
    expect(out).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Ghost / description edge cases
// ---------------------------------------------------------------------------
describe('ghost detection edge cases', () => {
  it('drops posting with [TEST] in title', async () => {
    const out = await filter([makeJob({ title: '[TEST] Software Engineer' })], makeConfig(), NOW);
    expect(out).toHaveLength(0);
  });

  it('drops posting with [DRAFT] in title', async () => {
    const out = await filter([makeJob({ title: '[DRAFT] Backend Engineer' })], makeConfig(), NOW);
    expect(out).toHaveLength(0);
  });

  it('drops posting whose description is all HTML tags (stripped length < 200)', async () => {
    const htmlOnly = '<p>'.repeat(100) + '</p>'.repeat(100);
    const out = await filter([makeJob({ description: htmlOnly })], makeConfig(), NOW);
    expect(out).toHaveLength(0);
  });

  it('keeps posting whose description is exactly 200 chars after strip', async () => {
    // 200 chars = boundary; isGhostJob checks < 200, so 200 is kept.
    const desc = 'A'.repeat(200);
    const out = await filter([makeJob({ description: desc })], makeConfig(), NOW);
    expect(out).toHaveLength(1);
  });

  it('drops posting whose description is 199 chars (one short of minimum)', async () => {
    const desc = 'A'.repeat(199);
    const out = await filter([makeJob({ description: desc })], makeConfig(), NOW);
    expect(out).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// intern-mismatch and strict-senior additional combos
// ---------------------------------------------------------------------------
describe('intern mismatch and strict senior — additional combos', () => {
  it('drops "internship" title for entry-level profile (not intern)', async () => {
    const cfg = makeConfig({
      profile: { ...makeConfig().profile, seniority: 'entry', roleFamily: [] },
    });
    const out = await filter([makeJob({ title: 'Software Engineering Internship' })], cfg, NOW);
    expect(out).toHaveLength(0);
  });

  it('keeps "internship" title for intern profile (own seniority — intern mismatch rule skips)', async () => {
    const cfg = makeConfig({
      profile: { ...makeConfig().profile, seniority: 'intern', roleFamily: [] },
    });
    const out = await filter([makeJob({ title: 'Software Engineering Internship' })], cfg, NOW);
    expect(out).toHaveLength(1);
  });

  it('drops "Director of Engineering" title for mid profile (strict senior)', async () => {
    const cfg = makeConfig({
      profile: { ...makeConfig().profile, seniority: 'mid', roleFamily: [] },
    });
    const out = await filter([makeJob({ title: 'Director of Engineering' })], cfg, NOW);
    expect(out).toHaveLength(0);
  });

  it('drops "Head of Engineering" title for mid profile (strict senior)', async () => {
    const cfg = makeConfig({
      profile: { ...makeConfig().profile, seniority: 'mid', roleFamily: [] },
    });
    const out = await filter([makeJob({ title: 'Head of Engineering' })], cfg, NOW);
    expect(out).toHaveLength(0);
  });

  it('drops "Lead Engineer" for entry-level profile (lead in title rule)', async () => {
    const cfg = makeConfig({
      profile: { ...makeConfig().profile, seniority: 'entry', roleFamily: [] },
    });
    const out = await filter([makeJob({ title: 'Lead Engineer' })], cfg, NOW);
    expect(out).toHaveLength(0);
  });

  it('keeps "Lead Engineer" for senior profile (lead rule only applies to entry)', async () => {
    const cfg = makeConfig({
      profile: { ...makeConfig().profile, seniority: 'senior', roleFamily: [] },
    });
    const out = await filter([makeJob({ title: 'Lead Engineer' })], cfg, NOW);
    expect(out).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Multiple jobs in one call — filter returns correct subset
// ---------------------------------------------------------------------------
describe('multi-job batch correctness', () => {
  it('returns only the passing jobs when the list is mixed', async () => {
    const cfg = makeConfig({ profile: { ...makeConfig().profile, roleFamily: [] } });
    const jobs = [
      makeJob({ id: 'test:keep1', title: 'Software Engineer' }),
      makeJob({ id: 'test:drop1', title: 'Mechanical Engineer' }),
      makeJob({ id: 'test:keep2', title: 'Backend Engineer' }),
      makeJob({ id: 'test:drop2', title: 'Pharmacist' }),
    ];
    const out = await filter(jobs, cfg, NOW);
    expect(out).toHaveLength(2);
    expect(out.map((j) => j.id)).toEqual(['test:keep1', 'test:keep2']);
  });

  it('returns an empty array when every job fails', async () => {
    const cfg = noRoleFamilyConfig();
    const jobs = [
      makeJob({ id: 'test:d1', title: 'Civil Engineer' }),
      makeJob({ id: 'test:d2', title: 'Nurse' }),
    ];
    const out = await filter(jobs, cfg, NOW);
    expect(out).toHaveLength(0);
  });

  it('returns an empty array for an empty input', async () => {
    const out = await filter([], makeConfig(), NOW);
    expect(out).toHaveLength(0);
  });
});
