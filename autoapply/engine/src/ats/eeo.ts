import type { FieldConcept, GuessedField } from '../types.ts';
import type { DetectedField, ReactSelectClasses, Surface } from './form-config.ts';
import { chooseOption, DECLINE_RE, fillScalar, readNativeOptions, readSelectOptions } from './form-dom.ts';

export const EEO_CONCEPTS: ReadonlySet<FieldConcept> = new Set([
  'gender',
  'genderIdentity',
  'pronouns',
  'sexualOrientation',
  'race',
  'veteranStatus',
  'disabilityStatus',
]);

/** Pick an option for a demographic self-ID question: the exact option, else the
 * form's decline option, else nothing. A fuzzy pick is never acceptable here — a
 * mismatched EEO answer is worse than none. `declined` marks a decline that was
 * substituted for a substantive profile value, so the caller flags it for review. */
export function eeoOption(options: readonly string[], value: string): { pick: string; declined: boolean } | null {
  const { idx, exact } = chooseOption(options, value);
  const exactPick = exact && idx !== -1 ? options[idx] : undefined;
  if (exactPick !== undefined) return { pick: exactPick, declined: false };
  const decline = options.find((o) => DECLINE_RE.test(o));
  return decline === undefined ? null : { pick: decline, declined: true };
}

/** Fill an EEO dropdown under the decline-or-blank policy. Returns 'filled' for
 * an exact pick, a GuessedField for a substituted decline, or null when the
 * field must be left for human review. */
export async function eeoFill(
  surface: Surface,
  field: DetectedField,
  value: string,
  rs: ReactSelectClasses,
): Promise<GuessedField | 'filled' | null> {
  const options = field.reactSelect
    ? await readSelectOptions(surface, field.id, rs)
    : await readNativeOptions(surface, field.id);
  if (options.length === 0) return null;
  const choice = eeoOption(options, value);
  if (choice === null) return null;
  const result = await fillScalar(surface, field, choice.pick, rs);
  if (!result.ok) return null;
  if (!choice.declined) return 'filled';
  return { fieldKey: field.id, question: field.label, answer: choice.pick, reason: 'dropdown' };
}
