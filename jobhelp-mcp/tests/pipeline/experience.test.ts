import { describe, expect, it } from 'vitest';
import { extractMinYears } from '../../core/pipeline/experience.js';

describe('extractMinYears: required-years parsing', () => {
  it('reads "X+ years" as X', () => {
    expect(extractMinYears('We need 6+ years of experience.')).toBe(6);
    expect(extractMinYears('Requires 2+ years building backend services.')).toBe(2);
  });

  it('reads a "X-Y years" range as its low end X', () => {
    expect(extractMinYears('You have 5-7 years of experience.')).toBe(5);
    expect(extractMinYears('3 to 6 years of professional experience required.')).toBe(3);
  });

  it('reads "at least X years" and "minimum of X years"', () => {
    expect(extractMinYears('At least 5 years of industry experience.')).toBe(5);
    expect(extractMinYears('Minimum of 8 years in a similar role.')).toBe(8);
  });

  it('reads the "X yrs" abbreviation', () => {
    expect(extractMinYears('Looking for 7 yrs experience in Go.')).toBe(7);
  });

  it("handles years/years'/years-of phrasings", () => {
    expect(extractMinYears("10+ years' experience in distributed systems.")).toBe(10);
    expect(extractMinYears('6+ years experience shipping software.')).toBe(6);
    expect(extractMinYears('5+ years of experience in TypeScript.')).toBe(5);
  });
});

describe('extractMinYears: required vs preferred', () => {
  it('ignores preferred/nice-to-have mentions and keeps only required', () => {
    expect(
      extractMinYears('2+ years of JavaScript required. 5+ years preferred.'),
    ).toBe(2);
    expect(
      extractMinYears('Requires 3+ years backend. 8+ years is a nice-to-have.'),
    ).toBe(3);
    expect(extractMinYears('Ideally 9+ years. But 4+ years required.')).toBe(4);
  });

  it('takes the minimum across multiple required mentions', () => {
    expect(
      extractMinYears('Requires 7+ years of backend. Also 3+ years of Python.'),
    ).toBe(3);
  });

  it('a bonus/plus mention alone yields no required minimum', () => {
    expect(extractMinYears('10+ years of Kubernetes a plus.')).toBeUndefined();
  });
});

describe('extractMinYears: entry-friendly neutralization', () => {
  it('returns 0 when a new-grad marker appears alongside a year range', () => {
    expect(extractMinYears('5-7 years OR new grads welcome to apply.')).toBe(0);
    expect(
      extractMinYears('5-7 years preferred but new grads encouraged.'),
    ).toBe(0);
  });

  it('treats 0-N year ranges and entry markers as entry-friendly (0)', () => {
    expect(extractMinYears('0-2 years of experience.')).toBe(0);
    expect(extractMinYears('This is an entry-level role.')).toBe(0);
    expect(extractMinYears('Recent graduates encouraged; 6+ years preferred.')).toBe(0);
    expect(extractMinYears('Internships count toward the requirement.')).toBe(0);
    expect(extractMinYears('No experience required.')).toBe(0);
  });
});

describe('extractMinYears: absence and bounds', () => {
  it('returns undefined when no year requirement is present', () => {
    expect(extractMinYears('We build great software with a talented team.')).toBeUndefined();
    expect(extractMinYears('')).toBeUndefined();
  });

  it('does not treat a bare "years of experience" phrase (no number) as a requirement', () => {
    expect(
      extractMinYears('Strong fundamentals matter more than years of experience.'),
    ).toBeUndefined();
  });

  it('only scans the bounded 3000-char prefix', () => {
    const buried = 'a'.repeat(3100) + ' 10+ years of experience required.';
    expect(extractMinYears(buried)).toBeUndefined();
    const upfront = '8+ years of experience required. ' + 'a'.repeat(3100);
    expect(extractMinYears(upfront)).toBe(8);
  });
});
