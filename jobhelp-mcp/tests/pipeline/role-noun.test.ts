import { describe, expect, it } from 'vitest';
import {
  detectRoleFamily,
  detectSeniorityLevel,
  detectTitleSeniority,
} from '../../core/pipeline/classify.js';
import { seniorityPenaltyFor } from '../../core/pipeline/blend.js';
import { buildLevelFitRank } from '../../core/pipeline/rrf.js';
import type { NormalizedJob } from '../../core/types/index.js';

const BODY_PAD =
  ' You will design APIs, own services end to end, and collaborate with product teams to ship.';

describe('detectRoleFamily: role-noun variants (audit-observed brittleness)', () => {
  it('recognizes Developer/SWE/SDE variants of core families', () => {
    expect(detectRoleFamily('AI/ML Developer', '')).toBe('ml');
    expect(detectRoleFamily('ML Developer, Agentic Systems', '')).toBe('ml');
    expect(detectRoleFamily('AI Developer', '')).toBe('ml');
    expect(detectRoleFamily('Backend Developer', '')).toBe('backend');
    expect(detectRoleFamily('Frontend Developer', '')).toBe('frontend');
    expect(detectRoleFamily('Platform Developer', '')).toBe('devops');
  });

  it('recognizes plain Software Engineer titles with suffixes (previously end-anchored)', () => {
    expect(detectRoleFamily('Software Engineer, Data Migration', '')).toBe('fullstack');
    expect(detectRoleFamily('Software Engineer (AWS)', '')).toBe('fullstack');
    expect(detectRoleFamily('Software Developer', '')).toBe('fullstack');
    expect(detectRoleFamily('Software Engineer', '')).toBe('fullstack');
  });

  it('recognizes bare SWE/SDE abbreviations', () => {
    expect(detectRoleFamily('SWE (AWS)', '')).toBe('fullstack');
    expect(detectRoleFamily('Displays SWE', '')).toBe('fullstack');
    expect(detectRoleFamily('SDE II', '')).toBe('fullstack');
    expect(detectRoleFamily('AI SWE', '')).toBe('ml');
  });

  it('does not claim QA or management titles for fullstack', () => {
    expect(detectRoleFamily('Software Engineer in Test', '')).toBeUndefined();
    expect(detectRoleFamily('Software Engineering Manager', '')).toBe('pm');
  });

  it('keeps config display-name mapping stable', () => {
    expect(detectRoleFamily('AI Engineer', '')).toBe('ml');
    expect(detectRoleFamily('LLM Engineer', '')).toBe('ml');
    expect(detectRoleFamily('Backend Engineer', '')).toBe('backend');
    expect(detectRoleFamily('Distributed Systems Engineer', '')).toBe('backend');
    expect(detectRoleFamily('Platform Engineer', '')).toBe('devops');
  });
});

describe('detectSeniorityLevel: modifier-tolerant description rules', () => {
  it('catches senior with modifier words before the role noun', () => {
    expect(
      detectSeniorityLevel('Great role', `We are hiring a Senior Full-Stack Engineer.${BODY_PAD}`),
    ).toBe('senior');
    expect(
      detectSeniorityLevel('Great role', `As a Senior Software Engineer you will lead.${BODY_PAD}`),
    ).toBe('senior');
    expect(
      detectSeniorityLevel('Great role', `Join as a Staff Machine Learning Engineer.${BODY_PAD}`),
    ).toBe('staff');
    expect(
      detectSeniorityLevel('Great role', `We want a Junior Backend Developer to grow.${BODY_PAD}`),
    ).toBe('entry');
  });

  it('does not fire on unrelated senior mentions without a role noun', () => {
    expect(
      detectSeniorityLevel('Great role', `We serve senior citizens with our platform.${BODY_PAD}`),
    ).toBeUndefined();
    expect(
      detectSeniorityLevel('Great role', `Report to our senior leadership team weekly.${BODY_PAD}`),
    ).toBeUndefined();
  });
});

describe('detectTitleSeniority: title-only signal for filter policy', () => {
  it('reads the title and ignores the description entirely', () => {
    expect(detectTitleSeniority('Senior Software Engineer')).toBe('senior');
    expect(detectTitleSeniority('Software Engineer II')).toBe('mid');
    expect(detectTitleSeniority('Software Engineer')).toBeUndefined();
  });
});

describe('ranking demotion covers what the filter now keeps', () => {
  it('description-only senior gets the gap-2 penalty for an entry profile', () => {
    const level = detectSeniorityLevel(
      'Full-Stack Engineer, AI & Automation',
      `We are looking for a Senior Full-Stack Engineer to own features.${BODY_PAD}`,
    );
    expect(seniorityPenaltyFor(level, 'entry')).toBe(0.6);
  });

  it('Engineer II titles get the gap-1 penalty instead of a hard drop', () => {
    expect(seniorityPenaltyFor(detectTitleSeniority('Software Engineer II'), 'entry')).toBe(0.85);
  });

  it('exact-level promotion is a rank list, not a multiplier', () => {
    expect(seniorityPenaltyFor('entry', 'entry')).toBe(1);
    expect(seniorityPenaltyFor(undefined, 'entry')).toBe(1);
    expect(seniorityPenaltyFor('entry', 'mid')).toBe(1);
  });
});

function levelJob(id: string, title: string): NormalizedJob {
  return {
    id,
    source: 'test',
    url: `https://example.com/${id}`,
    title,
    company: 'Acme',
    location: 'Remote (US)',
    remote: 'remote',
    description: 'Build services and ship features with a modern cloud stack.',
  };
}

describe('buildLevelFitRank', () => {
  it('orders exact match above no-signal above above-level for an entry profile', () => {
    const jobs = [
      levelJob('senior', 'Senior Software Engineer'),
      levelJob('plain', 'Software Engineer'),
      levelJob('newgrad', 'Software Engineer, New Grad'),
    ];
    const ranked = buildLevelFitRank(jobs, 'entry');
    const order = ranked.items.map((e) => e.job.id);
    expect(order).toEqual(['newgrad', 'plain', 'senior']);
  });

  it('treats below-level jobs as neutral, not promoted', () => {
    const jobs = [
      levelJob('entryjob', 'Junior Engineer'),
      levelJob('internjob', 'Software Engineering Intern'),
    ];
    const ranked = buildLevelFitRank(jobs, 'mid');
    const tiersById = new Map(ranked.items.map((e) => [e.job.id, e.rank]));
    expect(tiersById.get('internjob')).toBeGreaterThanOrEqual(1);
    const order = ranked.items.map((e) => e.job.id);
    expect(order[0]).toBe('entryjob');
  });
});
