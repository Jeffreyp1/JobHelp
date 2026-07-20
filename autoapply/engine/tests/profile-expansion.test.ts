import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadProfile } from '../src/profile.ts';
import { classifyLabel, answerFor } from '../src/match.ts';
import { EEO_CONCEPTS, eeoOption } from '../src/ats/eeo.ts';
import { EDUCATION_FIELD_RE, greenhouseConfig } from '../src/ats/greenhouse.ts';
import { FIELD_CONCEPTS } from '../src/types.ts';
import type { StandingProfile } from '../src/types.ts';
import type { DetectedField } from '../src/ats/form-config.ts';

const liveProfile = {
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.com',
  country: 'United States',
  location: 'San Jose, CA',
  workAuthorization: 'Yes',
  sponsorship: 'No',
  gender: 'Prefer not to say',
  relocation: 'Yes - open to relocating and to onsite/hybrid work',
  onsiteAvailability: 'Yes',
  percentHandsOnCoding: '75%',
  citizenship: 'US citizen',
  desiredSalaryPolicy: 'Match the posting range; if none, enter $50,000 as the minimum',
  relativesAtCompany: 'No',
  priorEmploymentAtCompany: 'No',
  acknowledgePrivacyNotices: 'Yes',
  pronouns: 'Prefer not to say',
  genderIdentity: 'Prefer not to say',
  sexualOrientation: 'Prefer not to say',
  education: [
    {
      school: 'Example State University',
      degree: "Bachelor's Degree",
      discipline: 'Computer Science',
      startYear: '2022',
      endYear: '2024',
    },
  ],
  _meta: { reviewedAt: '2026-06-10' },
};

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'profile-expansion-'));
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(tmpDir, { recursive: true, force: true });
});

async function writeProfile(content: unknown): Promise<string> {
  const p = join(tmpDir, 'autoapply-profile.json');
  await writeFile(p, JSON.stringify(content));
  return p;
}

describe('loadProfile accepts the expanded key set', () => {
  it('keeps every live-profile key instead of dropping it', async () => {
    const p = await writeProfile(liveProfile);
    const profile = await loadProfile(p);
    expect(profile.relocation).toBe('Yes - open to relocating and to onsite/hybrid work');
    expect(profile.onsiteAvailability).toBe('Yes');
    expect(profile.citizenship).toBe('US citizen');
    expect(profile.desiredSalaryPolicy).toContain('Match the posting');
    expect(profile.priorEmploymentAtCompany).toBe('No');
    expect(profile.relativesAtCompany).toBe('No');
    expect(profile.pronouns).toBe('Prefer not to say');
    expect(profile.genderIdentity).toBe('Prefer not to say');
    expect(profile.sexualOrientation).toBe('Prefer not to say');
    expect(profile.percentHandsOnCoding).toBe('75%');
    expect(profile.acknowledgePrivacyNotices).toBe('Yes');
  });

  it('warns naming truly unknown keys instead of dropping them silently', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const p = await writeProfile({ ...liveProfile, favoriteColor: 'blue' });
    await loadProfile(p);
    const warned = spy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(warned).toContain('favoriteColor');
    expect(warned).not.toContain('_meta');
    expect(warned).not.toContain('relocation');
  });

  it('does not warn when only known keys are present', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const p = await writeProfile(liveProfile);
    await loadProfile(p);
    expect(spy).not.toHaveBeenCalled();
  });

  it('parses optional education start/end months', async () => {
    const withMonths = {
      ...liveProfile,
      education: [{ ...liveProfile.education[0], startMonth: 'September', endMonth: 'June' }],
    };
    const p = await writeProfile(withMonths);
    const profile = await loadProfile(p);
    expect(profile.education?.[0]?.startMonth).toBe('September');
    expect(profile.education?.[0]?.endMonth).toBe('June');
  });

  it('leaves months undefined when the profile has only years', async () => {
    const p = await writeProfile(liveProfile);
    const profile = await loadProfile(p);
    expect(profile.education?.[0]?.startMonth).toBeUndefined();
    expect(profile.education?.[0]?.startYear).toBe('2022');
  });
});

describe('classifyLabel covers gap-log phrasings', () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ['Are you willing to relocate?', 'relocation'],
    ['If applicable, are you open to relocation?', 'relocation'],
    ["Will you need relocation assistance to work at this role's specified location?", 'relocation'],
    ['I am available to work onsite at our headquarters?', 'onsiteAvailability'],
    ['Are you able and excited to join us for in person, collaborative working sessions in office 2-3 days / week?', 'onsiteAvailability'],
    ['How often are you willing to work on-site in our office?', 'onsiteAvailability'],
    ['Are you a US Citizen, US National, or Lawful Permanent Resident, or do you require visa sponsorship?', 'citizenship'],
    ['What is your desired salary?', 'expectedSalary'],
    ['What is your desired base salary?', 'expectedSalary'],
    ['Desired Total Compensation?', 'expectedSalary'],
    ['What is your expected total compensation range (base salary + bonus)?', 'expectedSalary'],
    ['Do you have any relatives employed by Acme?', 'relativesAtCompany'],
    ['Have you ever worked at Acme before?', 'priorEmploymentAtCompany'],
    ['Have you previously been employed with Acme or any affiliates either full-time or part-time?', 'priorEmploymentAtCompany'],
    ['Are you currently employed by Acme or any affiliates- full time or part time?', 'priorEmploymentAtCompany'],
    ['What are your personal pronouns?', 'pronouns'],
    ['Gender Identity', 'genderIdentity'],
    ['Gender', 'gender'],
    ['Sexual Orientation', 'sexualOrientation'],
    ['What percentage of your day do you spend hands-on coding?', 'percentHandsOnCoding'],
    ['Do you acknowledge the Acme HR Privacy Notice?', 'acknowledgePrivacyNotices'],
    ['Do you acknowledge the Acme Job Applicant Privacy Policy?', 'acknowledgePrivacyNotices'],
    ['Which state do you currently reside in?', 'state'],
    ['Start date month', 'educationStartMonth'],
    ['End date month', 'educationEndMonth'],
  ];

  for (const [label, concept] of cases) {
    it(`classifies "${label.slice(0, 60)}" as ${concept}`, () => {
      expect(classifyLabel(label)).toBe(concept);
    });
  }

  it('leaves the export-control sanctioned-countries question unclassified', () => {
    expect(
      classifyLabel(
        'Please indicate whether you are either a citizen or resident of any of the following countries: Cuba, Iran, North Korea, Syria, or the Crimea region',
      ),
    ).toBeNull();
  });

  it('leaves desired start date unclassified (no fabricated date)', () => {
    expect(classifyLabel('What is your desired start date?')).toBeNull();
  });

  it('still classifies plain sponsorship questions as sponsorship', () => {
    expect(classifyLabel('Will you require sponsorship for employment visa status?')).toBe('sponsorship');
  });
});

describe('answerFor derivations', () => {
  const p: StandingProfile = {
    location: 'San Jose, CA',
    relocation: 'Yes - open to relocating and to onsite/hybrid work',
    percentHandsOnCoding: '75%',
    priorEmploymentAtCompany: 'No',
    acknowledgePrivacyNotices: 'Yes',
    desiredSalaryPolicy: 'Match the posting range; if none, enter $50,000 as the minimum',
  };

  it('derives the state name from a City, ST location', () => {
    expect(answerFor('state', p)).toBe('California');
    expect(answerFor('state', { location: 'San Francisco, CA' })).toBe('California');
  });

  it('prefers an explicit state key over the derivation', () => {
    expect(answerFor('state', { ...p, state: 'Nevada' })).toBe('Nevada');
  });

  it('returns undefined for state when location is missing or not US-shaped', () => {
    expect(answerFor('state', {})).toBeUndefined();
    expect(answerFor('state', { location: 'London, UK' })).toBeUndefined();
  });

  it('derives United States for country from a US location when no country key exists', () => {
    expect(answerFor('country', p)).toBe('United States');
  });

  it('an explicit country key wins over the derivation', () => {
    expect(answerFor('country', { ...p, country: 'Canada' })).toBe('Canada');
  });

  it('returns undefined for country when nothing is derivable', () => {
    expect(answerFor('country', { location: 'London, UK' })).toBeUndefined();
  });

  it('uses a numeric expectedSalary key verbatim', () => {
    expect(answerFor('expectedSalary', { ...p, expectedSalary: '$50,000' })).toBe('$50,000');
    expect(answerFor('expectedSalary', { expectedSalary: '85000' })).toBe('85000');
  });

  it('never fills a salary box from the policy sentence', () => {
    expect(answerFor('expectedSalary', p)).toBeUndefined();
    expect(answerFor('expectedSalary', { expectedSalary: 'Match the posting range' })).toBeUndefined();
  });

  it('desiredSalaryPolicy is session guidance, never a fill value', () => {
    expect(answerFor('desiredSalaryPolicy', p)).toBeUndefined();
  });

  it('answers relocation willingness from the profile', () => {
    expect(answerFor('relocation', p, 'Are you willing to relocate?')).toBe(
      'Yes - open to relocating and to onsite/hybrid work',
    );
  });

  it('does not answer relocation-assistance questions from the willingness value', () => {
    expect(
      answerFor('relocation', p, "Will you need relocation assistance to work at this role's specified location?"),
    ).toBeUndefined();
  });

  it('answers the remaining new concepts from their profile keys', () => {
    expect(answerFor('percentHandsOnCoding', p)).toBe('75%');
    expect(answerFor('priorEmploymentAtCompany', p)).toBe('No');
    expect(answerFor('acknowledgePrivacyNotices', p)).toBe('Yes');
  });

  it('unknown stays unknown: education months without profile data are undefined', () => {
    expect(answerFor('educationStartMonth', p)).toBeUndefined();
    expect(answerFor('educationEndMonth', p)).toBeUndefined();
  });
});

describe('EEO decline-or-blank extends to the new self-ID concepts', () => {
  it('EEO_CONCEPTS includes pronouns, genderIdentity, sexualOrientation', () => {
    expect(EEO_CONCEPTS.has('pronouns')).toBe(true);
    expect(EEO_CONCEPTS.has('genderIdentity')).toBe(true);
    expect(EEO_CONCEPTS.has('sexualOrientation')).toBe(true);
    expect(EEO_CONCEPTS.has('gender')).toBe(true);
  });

  it('a Prefer-not-to-say value picks the decline option without a review flag', () => {
    const pick = eeoOption(['He/him', 'She/her', 'They/them', 'I prefer not to say'], 'Prefer not to say');
    expect(pick).toEqual({ pick: 'I prefer not to say', declined: false });
  });
});

describe('greenhouse education month fields', () => {
  const field = (id: string): DetectedField => ({
    id,
    label: 'Start date month',
    tag: 'input',
    type: 'text',
    required: false,
    reactSelect: true,
  });

  const eduProfile: StandingProfile = {
    education: [
      {
        school: 'Example U',
        degree: "Bachelor's Degree",
        discipline: 'CS',
        startYear: '2022',
        endYear: '2024',
        startMonth: 'September',
        endMonth: 'June',
      },
    ],
  };

  it('EDUCATION_FIELD_RE recognizes month ids alongside year ids', () => {
    expect(EDUCATION_FIELD_RE.test('start-month--0')).toBe(true);
    expect(EDUCATION_FIELD_RE.test('end-month--1')).toBe(true);
    expect(EDUCATION_FIELD_RE.test('start-year--0')).toBe(true);
  });

  it('resolves months from the education entry like years', () => {
    expect(greenhouseConfig.resolveValue?.(field('start-month--0'), eduProfile)).toBe('September');
    expect(greenhouseConfig.resolveValue?.(field('end-month--0'), eduProfile)).toBe('June');
    expect(greenhouseConfig.resolveValue?.(field('start-year--0'), eduProfile)).toBe('2022');
  });

  it('returns undefined when the entry has no month, so the field goes to review', () => {
    const noMonths: StandingProfile = {
      education: [{ school: 'Example U', degree: 'BS', discipline: 'CS', startYear: '2022', endYear: '2024' }],
    };
    expect(greenhouseConfig.resolveValue?.(field('start-month--0'), noMonths)).toBeUndefined();
  });
});

describe('single source of truth for concepts', () => {
  it('FIELD_CONCEPTS contains the new concepts exactly once', () => {
    for (const c of [
      'relocation', 'onsiteAvailability', 'citizenship', 'desiredSalaryPolicy', 'expectedSalary',
      'priorEmploymentAtCompany', 'relativesAtCompany', 'pronouns', 'genderIdentity',
      'sexualOrientation', 'percentHandsOnCoding', 'acknowledgePrivacyNotices',
      'state', 'educationStartMonth', 'educationEndMonth',
    ]) {
      expect(FIELD_CONCEPTS).toContain(c);
    }
    expect(new Set(FIELD_CONCEPTS).size).toBe(FIELD_CONCEPTS.length);
  });
});
