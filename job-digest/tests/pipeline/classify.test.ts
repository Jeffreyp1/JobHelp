import { describe, it, expect } from 'vitest';
import {
  detectRoleFamily,
  isGhostJob,
  detectSeniorityLevel,
} from '../../core/pipeline/classify.js';

describe('detectRoleFamily', () => {
  it('classifies a product manager title as pm', () => {
    expect(detectRoleFamily('Product Manager, Sail Core', '')).toBe('pm');
  });

  it('classifies an operations associate as ops', () => {
    expect(detectRoleFamily('Operations Associate, GTM Accelerate', '')).toBe('ops');
  });

  it('classifies a finance analyst title as analyst', () => {
    expect(detectRoleFamily('Finance & Strategy Analytics Analyst', '')).toBe('analyst');
  });

  it('classifies an offensive security engineer as security', () => {
    expect(detectRoleFamily('Security Engineer - Offensive Security', '')).toBe('security');
  });

  it('returns undefined for ambiguous Network Solution Lead', () => {
    expect(detectRoleFamily('Network Solution Lead', '')).toBeUndefined();
  });

  it('classifies an android engineer as mobile', () => {
    expect(detectRoleFamily('Android Engineer, Terminal', '')).toBe('mobile');
  });

  it('classifies a backend SWE as backend', () => {
    expect(detectRoleFamily('Software Engineer, Backend', '')).toBe('backend');
  });

  it('classifies a frontend SWE as frontend', () => {
    expect(detectRoleFamily('Frontend Engineer, Privy', '')).toBe('frontend');
  });

  it('classifies a fullstack engineer as fullstack', () => {
    expect(detectRoleFamily('Full Stack Engineer', '')).toBe('fullstack');
  });

  it('classifies a plain Software Engineer as fullstack (generic SWE bucket)', () => {
    expect(detectRoleFamily('Software Engineer', '')).toBe('fullstack');
  });

  it('classifies an SRE as sre', () => {
    expect(detectRoleFamily('Site Reliability Engineer', '')).toBe('sre');
  });

  it('classifies an ML engineer as ml', () => {
    expect(detectRoleFamily('ML Engineer', '')).toBe('ml');
  });

  it('classifies a design engineer as designer', () => {
    expect(detectRoleFamily('Designer, Design Engineer', '')).toBe('designer');
  });

  it('returns undefined when no role words match', () => {
    expect(detectRoleFamily('Senior Widget Wrangler', '')).toBeUndefined();
  });

  // F4 regression: `technical product` substring must not over-match architect titles
  it('Technical Product Architect is NOT pm (it is an architect role)', () => {
    expect(detectRoleFamily('Technical Product Architect', '')).not.toBe('pm');
  });
  it('Technical Product Manager is pm (F4 regression — still caught)', () => {
    expect(detectRoleFamily('Technical Product Manager', '')).toBe('pm');
  });
  it('Technical Product Owner is pm (F4 regression — still caught)', () => {
    expect(detectRoleFamily('Technical Product Owner', '')).toBe('pm');
  });

  // F5 regression: `services engineer` must not swallow IC engineering titles
  it('Field Services Engineer is NOT solutions-architect (F5 regression)', () => {
    expect(detectRoleFamily('Field Services Engineer', '')).not.toBe('solutions-architect');
  });
  it('Professional Services Engineer is NOT solutions-architect (F5 regression)', () => {
    expect(detectRoleFamily('Professional Services Engineer', '')).not.toBe('solutions-architect');
  });
  it('Services Architect 3 is solutions-architect (F5 positive — still caught)', () => {
    expect(detectRoleFamily('Services Architect 3', '')).toBe('solutions-architect');
  });
  it('Services Lead is solutions-architect (F5 positive — still caught)', () => {
    expect(detectRoleFamily('Services Lead', '')).toBe('solutions-architect');
  });
});

describe('isGhostJob', () => {
  const longDesc = 'We are looking for an experienced software engineer to join our team. '.repeat(20);

  it('flags [TEMPLATE] Default Template as ghost', () => {
    expect(isGhostJob({ title: '[TEMPLATE] Default Template', description: longDesc })).toBe(true);
  });

  it('flags [TEST] Engineering Position as ghost', () => {
    expect(isGhostJob({ title: '[TEST] Engineering Position', description: longDesc })).toBe(true);
  });

  it('does not flag a real SWE job with a 5KB description', () => {
    const desc = 'Lorem ipsum dolor sit amet '.repeat(200);
    expect(isGhostJob({ title: 'Backend Engineer', description: desc })).toBe(false);
  });

  it('flags a real SWE title with a 100-character description as ghost', () => {
    expect(
      isGhostJob({
        title: 'Backend Engineer',
        description: 'We are hiring engineers. Apply now to join us. Great team and benefits.',
      }),
    ).toBe(true);
  });

  it('flags a short description even for a Software Engineer title', () => {
    expect(isGhostJob({ title: 'Software Engineer', description: 'We are hiring.' })).toBe(true);
  });

  it('does not flag when HTML stripping leaves >200 chars of real content', () => {
    const desc =
      '<p>We are looking for a talented backend engineer to build distributed systems at scale. ' +
      'You will work on our payments infrastructure, helping millions of users daily. ' +
      'The ideal candidate has experience with Go and TypeScript, strong fundamentals, ' +
      'and a passion for clean architecture.</p>';
    expect(isGhostJob({ title: 'Backend Engineer', description: desc })).toBe(false);
  });
});

describe('detectSeniorityLevel', () => {
  it('classifies Software Engineer II as mid', () => {
    expect(detectSeniorityLevel('Software Engineer II - Web Engineering', '')).toBe('mid');
  });

  it('classifies Forward Deployed Engineer as senior', () => {
    expect(detectSeniorityLevel('Forward Deployed Engineer, Privy', '')).toBe('senior');
  });

  it('classifies Staff Engineer as staff', () => {
    expect(detectSeniorityLevel('Staff Engineer, ML', '')).toBe('staff');
  });

  it('classifies Principal Engineer as staff', () => {
    expect(detectSeniorityLevel('Principal Engineer', '')).toBe('staff');
  });

  it('classifies Software Engineering Intern as intern', () => {
    expect(detectSeniorityLevel('Software Engineering Intern', '')).toBe('intern');
  });

  it('classifies Junior Backend Engineer as entry', () => {
    expect(detectSeniorityLevel('Junior Backend Engineer', '')).toBe('entry');
  });

  it('returns undefined for plain Software Engineer with no markers', () => {
    expect(detectSeniorityLevel('Software Engineer', '')).toBeUndefined();
  });

  it('returns undefined when title is silent and description signal is weak', () => {
    expect(
      detectSeniorityLevel('Software Engineer', "We're hiring senior engineers"),
    ).toBeUndefined();
  });
});
