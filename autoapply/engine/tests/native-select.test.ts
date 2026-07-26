import { describe, it, expect } from 'vitest';
import { fillScalar } from '../src/ats/form-dom.ts';
import { applyAnswer } from '../src/ats/react-select.ts';
import type { DetectedField, Surface } from '../src/ats/form-config.ts';

interface FakeOption {
  readonly value: string;
  readonly text: string;
}

function fakeNativeSelect(options: readonly FakeOption[]): { surface: Surface; selectedValue: () => string } {
  let selected = '';
  const optionEls = options.map((o) => ({ value: o.value, textContent: o.text }));
  const optionLocator = {
    evaluateAll: (fn: (els: unknown[]) => unknown) => Promise.resolve(fn(optionEls)),
  };
  const locator = {
    first: () => locator,
    locator: (sel: string) => (sel === 'option' ? optionLocator : locator),
    evaluate: (fn: (el: { tagName: string; getAttribute: (n: string) => string | null }) => unknown) =>
      Promise.resolve(fn({ tagName: 'SELECT', getAttribute: () => null })),
    selectOption: (values: { label?: string }) => {
      const hit = options.find((o) => o.text === values.label);
      if (!hit) return Promise.reject(new Error(`no option labeled ${JSON.stringify(values.label)}`));
      selected = hit.value;
      return Promise.resolve([hit.value]);
    },
    inputValue: () => Promise.resolve(selected),
  };
  const surface = { locator: () => locator } as unknown as Surface;
  return { surface, selectedValue: () => selected };
}

const COUNTRIES: readonly FakeOption[] = [
  { value: '', text: 'Select...' },
  { value: 'usa', text: 'United States of America' },
  { value: 'ca', text: 'Canada' },
  { value: 'mx', text: 'Mexico' },
];

function selectField(over: Partial<DetectedField> = {}): DetectedField {
  return { id: 'country', label: 'Country', tag: 'select', type: 'select', required: true, reactSelect: false, ...over };
}

describe('fillScalar — native <select> fallback matching', () => {
  it('selects an exact label without a guess', async () => {
    const { surface, selectedValue } = fakeNativeSelect([
      { value: '', text: 'Select...' },
      { value: 'us', text: 'United States' },
      { value: 'ca', text: 'Canada' },
    ]);
    const r = await fillScalar(surface, selectField(), 'United States');
    expect(r).toEqual({ ok: true });
    expect(selectedValue()).toBe('us');
  });

  it('falls back to option matching: "United States" selects "United States of America"', async () => {
    const { surface, selectedValue } = fakeNativeSelect(COUNTRIES);
    const r = await fillScalar(surface, selectField(), 'United States');
    expect(r.ok).toBe(true);
    expect(r.guess).toBeUndefined();
    expect(selectedValue()).toBe('usa');
  });

  it('selects by the matched option text despite a filtered placeholder shifting indexes', async () => {
    const { surface, selectedValue } = fakeNativeSelect(COUNTRIES);
    await fillScalar(surface, selectField(), 'United States');
    expect(selectedValue()).not.toBe('');
  });

  it('flags a fuzzy hit as a dropdown guess: "Yes" lands on "Yes, I am"', async () => {
    const { surface, selectedValue } = fakeNativeSelect([
      { value: '', text: 'Select...' },
      { value: '1', text: 'Yes, I am' },
      { value: '0', text: 'No, I am not' },
    ]);
    const field = selectField({ id: 'authorized', label: 'Are you authorized to work in the US?' });
    const r = await fillScalar(surface, field, 'Yes');
    expect(r.ok).toBe(true);
    expect(r.guess).toEqual({
      fieldKey: 'authorized',
      question: 'Are you authorized to work in the US?',
      answer: 'Yes, I am',
      reason: 'dropdown',
    });
    expect(selectedValue()).toBe('1');
  });

  it('leaves the field unfilled when nothing plausibly matches', async () => {
    const { surface, selectedValue } = fakeNativeSelect([
      { value: 'r', text: 'Red' },
      { value: 'b', text: 'Blue' },
    ]);
    const r = await fillScalar(surface, selectField(), 'Quantum computing');
    expect(r).toEqual({ ok: false });
    expect(selectedValue()).toBe('');
  });
});

describe('applyAnswer — native <select> fallback matching', () => {
  it('applies an exact label', async () => {
    const { surface, selectedValue } = fakeNativeSelect(COUNTRIES);
    expect(await applyAnswer(surface, 'country', 'Canada')).toBe(true);
    expect(selectedValue()).toBe('ca');
  });

  it('falls back to option matching for a near-miss label', async () => {
    const { surface, selectedValue } = fakeNativeSelect(COUNTRIES);
    expect(await applyAnswer(surface, 'country', 'United States')).toBe(true);
    expect(selectedValue()).toBe('usa');
  });

  it('maps a decline answer to the decline option', async () => {
    const { surface, selectedValue } = fakeNativeSelect([
      { value: '', text: 'Select...' },
      { value: 'm', text: 'Male' },
      { value: 'f', text: 'Female' },
      { value: 'd', text: "I don't wish to answer" },
    ]);
    expect(await applyAnswer(surface, 'gender', 'Prefer not to say')).toBe(true);
    expect(selectedValue()).toBe('d');
  });

  it('returns false when nothing matches', async () => {
    const { surface, selectedValue } = fakeNativeSelect(COUNTRIES);
    expect(await applyAnswer(surface, 'country', 'Atlantis')).toBe(false);
    expect(selectedValue()).toBe('');
  });
});
