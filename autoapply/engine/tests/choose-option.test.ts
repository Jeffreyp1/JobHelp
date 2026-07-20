import { describe, it, expect } from 'vitest';
import { chooseOption, isDeclineValue, DECLINE_RE } from '../src/ats/react-select.ts';
import { fillChoiceGroup, type ChoiceGroup } from '../src/ats/choice-groups.ts';
import type { Surface } from '../src/ats/form-config.ts';

const VETERAN = [
  'I am not a protected veteran',
  'I identify as one or more of the classifications of a protected veteran',
  "I don't wish to answer",
];

const DISABILITY = [
  'Yes, I have a disability, or have had one in the past',
  'No, I do not have a disability and have not had one in the past',
  "I don't wish to answer",
];

const RACE = ['White', 'Asian', 'Two or More Races', 'Decline To Self Identify'];

describe('chooseOption — decline values', () => {
  it('maps "Prefer not to say" to the veteran decline option, not the "not" option', () => {
    expect(chooseOption(VETERAN, 'Prefer not to say')).toEqual({ idx: 2, exact: true });
  });

  it('maps "Prefer not to say" to the disability decline option, skipping "No, I do not..."', () => {
    expect(chooseOption(DISABILITY, 'Prefer not to say')).toEqual({ idx: 2, exact: true });
  });

  it('maps "Prefer not to say" to "Decline To Self Identify"', () => {
    expect(chooseOption(RACE, 'Prefer not to say')).toEqual({ idx: 3, exact: true });
  });

  it('maps "Decline to self-identify" to the apostrophe-form decline option', () => {
    expect(chooseOption(VETERAN, 'Decline to self-identify')).toEqual({ idx: 2, exact: true });
  });

  it('returns no pick for a decline value when no decline option exists', () => {
    const substantiveOnly = VETERAN.slice(0, 2);
    expect(chooseOption(substantiveOnly, 'Prefer not to say').idx).toBe(-1);
  });

  it('still matches a literal decline option by equality', () => {
    expect(chooseOption(VETERAN, "I don't wish to answer")).toEqual({ idx: 2, exact: true });
  });
});

describe('isDeclineValue / DECLINE_RE', () => {
  it.each([
    'Prefer not to say',
    'Prefer not to answer',
    'Decline to self identify',
    'Decline to answer',
    'Decline to state',
    "I don't wish to answer",
    'I don’t wish to answer',
    'I do not wish to disclose',
    'Choose not to identify',
  ])('treats %j as a decline value', (v) => {
    expect(isDeclineValue(v)).toBe(true);
  });

  it.each(['I am not a protected veteran', 'No', 'Yes, I am', 'United States'])(
    'does not treat %j as a decline value',
    (v) => {
      expect(isDeclineValue(v)).toBe(false);
    },
  );

  it('exports the regex for other call sites', () => {
    expect(DECLINE_RE.test("i don't wish to answer")).toBe(true);
  });
});

describe('chooseOption — substring hits are demoted to guesses when weak', () => {
  it('never returns exact for a short numeric probe over range options', () => {
    const r = chooseOption(['0-1', '1-2', '2-4'], '2');
    expect(r.exact).toBe(false);
  });

  it('demotes a short value even with a unique prefix hit', () => {
    const r = chooseOption(['Yes, I am', 'No, I am not'], 'Yes');
    expect(r.idx).toBe(0);
    expect(r.exact).toBe(false);
  });

  it('keeps a single unambiguous long prefix hit exact', () => {
    expect(chooseOption(['United States of America', 'Canada', 'Mexico'], 'United States')).toEqual({
      idx: 0,
      exact: true,
    });
  });

  it('demotes a prefix hit when several options contain the value', () => {
    const r = chooseOption(
      ['United States of America', 'United States Minor Outlying Islands'],
      'United States',
    );
    expect(r.exact).toBe(false);
  });

  it('keeps plain equality exact', () => {
    expect(chooseOption(['Yes', 'No'], 'Yes')).toEqual({ idx: 0, exact: true });
  });
});

describe('chooseOption — fuzzy tier', () => {
  it('does not pick the referral option for "Company website"', () => {
    const options = ['LinkedIn', 'Friend/know someone at the company', 'Job board', 'Other'];
    expect(chooseOption(options, 'Company website').idx).toBe(-1);
  });

  it('still matches a school on its distinctive tokens', () => {
    const options = ['Academy of Art University', 'Example State University - Fremont'];
    expect(chooseOption(options, 'Example State University, Fremont')).toEqual({ idx: 1, exact: false });
  });

  it('returns no pick when the value has no distinctive tokens', () => {
    expect(chooseOption(['Affirmative', 'Negative'], 'Yes').idx).toBe(-1);
  });
});

function fakeRadioSurface(): { surface: Surface; anyChecked: () => boolean } {
  let checkedSel: string | null = null;
  const surface = {
    locator: (sel: string) => {
      const loc = {
        first: () => loc,
        check: () => {
          checkedSel = sel;
          return Promise.resolve();
        },
        click: () => {
          checkedSel = sel;
          return Promise.resolve();
        },
        isChecked: () => Promise.resolve(checkedSel === sel),
      };
      return loc;
    },
  } as unknown as Surface;
  return { surface, anyChecked: () => checkedSel !== null };
}

const veteranGroup: ChoiceGroup = {
  key: 'veteran_status',
  label: 'Veteran Status',
  required: true,
  kind: 'radio',
  options: VETERAN.map((label, i) => ({ label, id: `veteran_${i}`, value: String(i) })),
};

describe('fillChoiceGroup — radio groups route through the shared matcher', () => {
  it('checks the decline option for an opt-out value without flagging a guess', async () => {
    const { surface } = fakeRadioSurface();
    const r = await fillChoiceGroup(surface, veteranGroup, 'Prefer not to say');
    expect(r).toEqual({ ok: true, guessed: false, chosen: "I don't wish to answer" });
  });

  it('checks an exact-label option', async () => {
    const { surface } = fakeRadioSurface();
    const r = await fillChoiceGroup(surface, veteranGroup, 'I am not a protected veteran');
    expect(r).toEqual({ ok: true, guessed: false, chosen: 'I am not a protected veteran' });
  });

  it('leaves the group untouched when nothing matches', async () => {
    const { surface, anyChecked } = fakeRadioSurface();
    const r = await fillChoiceGroup(surface, veteranGroup, 'Purple elephants');
    expect(r).toEqual({ ok: false, guessed: false });
    expect(anyChecked()).toBe(false);
  });
});

interface FakeCall {
  readonly what: string;
  readonly timeout?: number | undefined;
}

function hiddenInputSurface(opts: { labelClickWorks: boolean }): {
  surface: Surface;
  el: { checked: boolean; events: string[] };
  calls: FakeCall[];
} {
  const el = {
    checked: false,
    events: [] as string[],
    dispatchEvent(e: { type: string }): boolean {
      el.events.push(e.type);
      return true;
    },
  };
  const calls: FakeCall[] = [];
  const labelLoc = {
    first: () => labelLoc,
    click: (o?: { timeout?: number }) => {
      calls.push({ what: 'labelClick', timeout: o?.timeout });
      if (opts.labelClickWorks) {
        el.checked = true;
        return Promise.resolve();
      }
      return Promise.reject(new Error('label not clickable'));
    },
  };
  const inputLoc = {
    first: () => inputLoc,
    check: (o?: { timeout?: number }) => {
      calls.push({ what: 'check', timeout: o?.timeout });
      return Promise.reject(new Error('element is not visible'));
    },
    isChecked: () => Promise.resolve(el.checked),
    evaluate: (fn: (e: unknown) => unknown) => {
      calls.push({ what: 'evaluate' });
      return Promise.resolve(fn(el));
    },
    locator: (sel: string) => {
      calls.push({ what: `wrap:${sel}` });
      return labelLoc;
    },
  };
  const surface = {
    locator: (sel: string) => (sel.startsWith('label[for=') ? labelLoc : inputLoc),
  } as unknown as Surface;
  return { surface, el, calls };
}

describe('fillChoiceGroup — hidden styled inputs', () => {
  it('falls back to clicking label[for] when check() on the input times out, with 1500ms timeouts', async () => {
    const { surface, el, calls } = hiddenInputSurface({ labelClickWorks: true });
    const r = await fillChoiceGroup(surface, veteranGroup, 'I am not a protected veteran');
    expect(r).toEqual({ ok: true, guessed: false, chosen: 'I am not a protected veteran' });
    expect(el.checked).toBe(true);
    expect(calls).toContainEqual({ what: 'check', timeout: 1500 });
    expect(calls).toContainEqual({ what: 'labelClick', timeout: 1500 });
    expect(calls.map((c) => c.what)).not.toContain('evaluate');
  });

  it('last resort sets checked and dispatches bubbling click+change when the label click also fails', async () => {
    const { surface, el, calls } = hiddenInputSurface({ labelClickWorks: false });
    const r = await fillChoiceGroup(surface, veteranGroup, 'I am not a protected veteran');
    expect(r).toEqual({ ok: true, guessed: false, chosen: 'I am not a protected veteran' });
    expect(el.checked).toBe(true);
    expect(el.events).toEqual(['click', 'change']);
    expect(calls.map((c) => c.what)).toContain('evaluate');
  });

  it('uses the wrapping label when the option has no id', async () => {
    const idless: ChoiceGroup = {
      ...veteranGroup,
      options: veteranGroup.options.map((o) => ({ ...o, id: '' })),
    };
    const { surface, el, calls } = hiddenInputSurface({ labelClickWorks: true });
    const r = await fillChoiceGroup(surface, idless, 'I am not a protected veteran');
    expect(r.ok).toBe(true);
    expect(el.checked).toBe(true);
    expect(calls.map((c) => c.what)).toContain('wrap:xpath=ancestor::label[1]');
  });
});
