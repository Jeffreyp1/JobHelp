import { describe, it, expect } from 'vitest';
import { classifyLabel, answerFor } from '../src/match.ts';
import type { StandingProfile } from '../src/types.ts';

const authorizedNoSponsorship: StandingProfile = { workAuthorization: 'Yes', sponsorship: 'No' };
const needsSponsorship: StandingProfile = { workAuthorization: 'Yes', sponsorship: 'Yes' };
const notAuthorized: StandingProfile = { workAuthorization: 'No', sponsorship: 'Yes' };

function fill(label: string, profile: StandingProfile): string | undefined {
  const concept = classifyLabel(label);
  return concept ? answerFor(concept, profile) : undefined;
}

const AVRIDE_LABEL =
  'I am authorized to work in the United States and do not require current or future visa sponsorship';
const METRIPORT_LABEL = 'Will you now or in the future require U.S. Work Authorization?';

describe('yes/no polarity', () => {
  describe('combined-statement agreement', () => {
    it('answers Yes when authorized and no sponsorship needed (Avride label)', () => {
      expect(fill(AVRIDE_LABEL, authorizedNoSponsorship)).toBe('Yes');
    });

    it('answers No when sponsorship is needed', () => {
      expect(fill(AVRIDE_LABEL, needsSponsorship)).toBe('No');
    });

    it('answers No when not authorized', () => {
      expect(fill(AVRIDE_LABEL, notAuthorized)).toBe('No');
    });

    it('returns undefined when profile values are indeterminate', () => {
      expect(fill(AVRIDE_LABEL, { workAuthorization: 'Maybe', sponsorship: 'Depends' })).toBeUndefined();
    });

    it('returns undefined when sponsorship is missing from the profile', () => {
      expect(fill(AVRIDE_LABEL, { workAuthorization: 'Yes' })).toBeUndefined();
    });

    it('treats "without sponsorship" phrasing as statement agreement', () => {
      expect(fill('I can work in the United States without visa sponsorship', authorizedNoSponsorship)).toBe('Yes');
    });
  });

  describe('requirement phrasing answers from the need side', () => {
    it('answers No to a future-authorization-requirement question (Metriport label)', () => {
      expect(fill(METRIPORT_LABEL, authorizedNoSponsorship)).toBe('No');
    });

    it('answers Yes when sponsorship is needed', () => {
      expect(fill(METRIPORT_LABEL, needsSponsorship)).toBe('Yes');
    });

    it('returns undefined when the need side is unknown', () => {
      expect(fill(METRIPORT_LABEL, { workAuthorization: 'Yes' })).toBeUndefined();
    });
  });

  describe('explicit label threading', () => {
    it('answers polarity from an explicit label without relying on classifyLabel state', () => {
      classifyLabel('Email address');
      expect(answerFor('sponsorship', authorizedNoSponsorship, AVRIDE_LABEL)).toBe('Yes');
    });

    it('requirement phrasing resolves through the explicit label', () => {
      classifyLabel('Email address');
      expect(answerFor('workAuthorization', authorizedNoSponsorship, METRIPORT_LABEL)).toBe('No');
    });

    it('an explicit label wins over stale classifyLabel state', () => {
      classifyLabel(METRIPORT_LABEL);
      expect(answerFor('workAuthorization', authorizedNoSponsorship, AVRIDE_LABEL)).toBe('Yes');
    });
  });

  describe('plain phrasing keeps existing behavior', () => {
    it('possession question uses the workAuthorization value', () => {
      expect(fill('Are you legally authorized to work in the United States?', authorizedNoSponsorship)).toBe('Yes');
    });

    it('sponsorship requirement question uses the sponsorship value', () => {
      expect(fill('Will you require sponsorship for employment visa status?', authorizedNoSponsorship)).toBe('No');
    });

    it('answerFor after classifying an unrelated label returns the raw stored value', () => {
      classifyLabel('Email address');
      expect(answerFor('sponsorship', authorizedNoSponsorship)).toBe('No');
    });
  });
});
