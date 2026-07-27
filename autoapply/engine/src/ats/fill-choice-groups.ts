import type { GuessedField, StandingProfile } from '../types.ts';
import type { FilledField } from './types.ts';
import type { AtsConfig, Surface } from './form-config.ts';
import { detectChoiceGroups, fillChoiceGroup } from './choice-groups.ts';
import { classifyLabelWithRules, answerFor } from '../match.ts';
import { lookupApproved } from '../answer-bank.ts';
import { EEO_CONCEPTS, eeoOption } from './eeo.ts';

export interface ChoiceFillResult {
  readonly filled: number;
  readonly guesses: readonly GuessedField[];
  readonly fields: readonly FilledField[];
}

/** Choice groups (radio/checkbox) aren't in detected fields — detect-controls
 * skips them. Auto-select the option matching a profile value (EEO, yes/no); an
 * unmatched group stays unselected for validate's requiredUncheckedGroups.
 * Adapter toggle groups (styled button pairs, aria radiogroups) join the same
 * loop; ones already carrying a selection are left alone. */
export async function fillChoiceGroups(
  surface: Surface,
  cfg: AtsConfig,
  profile: StandingProfile,
): Promise<ChoiceFillResult> {
  let filled = 0;
  const guesses: GuessedField[] = [];
  const fields: FilledField[] = [];
  const toggles = cfg.detectToggleGroups === undefined ? [] : await cfg.detectToggleGroups(surface, cfg);
  for (const group of [...(await detectChoiceGroups(surface, cfg)), ...toggles]) {
    if (group.checked === true) continue;
    const concept = classifyLabelWithRules(group.label, cfg.name);
    const profileValue = concept ? answerFor(concept, profile, group.label) : undefined;
    const replay =
      profileValue === undefined ? await lookupApproved(group.label, group.options.map((o) => o.label)) : null;
    const value = profileValue ?? replay?.answer;
    if (value === undefined) continue;
    let target = value;
    let declined = false;
    // The EEO decline-or-blank remap translates profile-style values; a bank
    // answer is already the concrete option text the human approved.
    if (profileValue !== undefined && concept !== null && EEO_CONCEPTS.has(concept)) {
      const choice = eeoOption(group.options.map((o) => o.label), value);
      if (choice === null) continue;
      target = choice.pick;
      declined = choice.declined;
    }
    const r = await fillChoiceGroup(surface, group, target);
    if (!r.ok) continue;
    filled += 1;
    const chosen = r.chosen ?? target;
    const flagged = r.guessed || declined || (replay !== null && !replay.exact);
    if (flagged) guesses.push({ fieldKey: group.key, question: group.label, answer: chosen, reason: 'dropdown' });
    const base = {
      fieldKey: group.key,
      question: group.label,
      value: chosen,
      options: group.options.map((o) => o.label),
      required: group.required,
    };
    if (replay !== null && replay.exact && !flagged) {
      fields.push({ ...base, source: 'answer-bank', exact: true });
    } else if (replay !== null && !replay.exact) {
      fields.push({ ...base, source: 'answer-bank', exact: false, reason: 'dropdown' });
    } else if (flagged) {
      fields.push({ ...base, source: 'guessed', reason: 'dropdown' });
    } else {
      fields.push({ ...base, source: 'profile' });
    }
  }
  return { filled, guesses, fields };
}
