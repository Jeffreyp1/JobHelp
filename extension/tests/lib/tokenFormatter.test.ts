import { describe, it, expect } from 'vitest';
import { formatTokens, formatCurrency } from '../../src/lib/tokenFormatter';

describe('tokenFormatter', () => {
  it('T11: formatTokens(2847) returns "2,847 tok"', () => {
    expect(formatTokens(2847)).toBe('2,847 tok');
  });

  it('T12: formatTokens(0) returns "0 tok"', () => {
    expect(formatTokens(0)).toBe('0 tok');
  });

  it('T13: formatTokens(1234567) returns "1,234,567 tok"', () => {
    expect(formatTokens(1234567)).toBe('1,234,567 tok');
  });

  it('T14: formatCurrency(0.008) returns "$0.008"', () => {
    expect(formatCurrency(0.008)).toBe('$0.008');
  });

  it('T15: formatCurrency(2.5) returns "$2.50"', () => {
    expect(formatCurrency(2.5)).toBe('$2.50');
  });
});
