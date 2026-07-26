import type { FieldConcept, FreeformQuestion, GuessedField, StandingProfile } from '../types.ts';
import type { AtsConfig, DetectedField, ReactSelectClasses, Surface } from './form-config.ts';
import { classifyLabelWithRules, loadLabelOverrides, answerFor } from '../match.ts';
import { lookupApproved } from '../answer-bank.ts';
import { EEO_CONCEPTS, eeoFill } from './eeo.ts';
import { batchFillText, fillScalar, readNativeOptions, readSelectOptions } from './form-dom.ts';

const BATCH_TEXT_TYPES = new Set(['text', 'email', 'tel', 'url', 'textarea']);

/** Build the handoff question for a field the tool couldn't fill itself. Reads
 * options for fixed-list dropdowns; async autocompletes and text fields become
 * free-text questions. */
export async function openQuestionFor(
  surface: Surface,
  field: DetectedField,
  rs: ReactSelectClasses,
): Promise<FreeformQuestion> {
  if (field.tag === 'textarea') return { fieldKey: field.id, label: field.label, kind: 'textarea' };
  if (field.reactSelect) {
    const options = await readSelectOptions(surface, field.id, rs);
    if (options.length > 0) return { fieldKey: field.id, label: field.label, kind: 'select', options };
  } else if (field.tag === 'select') {
    const options = await readNativeOptions(surface, field.id);
    if (options.length > 0) return { fieldKey: field.id, label: field.label, kind: 'select', options };
  }
  return { fieldKey: field.id, label: field.label, kind: 'text' };
}

function valueFor(
  field: DetectedField,
  profile: StandingProfile,
  cfg: AtsConfig,
): { value: string | undefined; concept: FieldConcept | null } {
  const resolved = cfg.resolveValue?.(field, profile);
  if (resolved !== undefined) return { value: resolved, concept: null };
  const concept = classifyLabelWithRules(field.label, cfg.name);
  return { value: concept ? answerFor(concept, profile, field.label) : undefined, concept };
}

function batchable(field: DetectedField): boolean {
  return field.id !== '' && !field.reactSelect && field.tag !== 'select' && BATCH_TEXT_TYPES.has(field.type);
}

export interface FieldFillOutcome {
  filledKnown: number;
  readonly freeform: FreeformQuestion[];
  readonly guesses: GuessedField[];
}

/** Fill every detected scalar field. Plain text-ish fields (text/email/tel/url/
 * textarea) go through ONE batched evaluate; only the ones whose value did not
 * stick fall back to the per-field fill + read-back path, so a silently swallowed
 * value still gets caught. Selects, comboboxes and EEO dropdowns keep their
 * per-field drivers. Radio/checkbox/file and unkeyable controls are skipped here:
 * choice groups and uploads have their own paths, and validate fails closed on
 * unkeyed controls. */
export async function fillDetectedFields(
  surface: Surface,
  cfg: AtsConfig,
  fields: readonly DetectedField[],
  profile: StandingProfile,
  rs: ReactSelectClasses,
): Promise<FieldFillOutcome> {
  await loadLabelOverrides();
  const plans = fields.map((field) => {
    const skip = field.type === 'radio' || field.type === 'checkbox' || field.type === 'file' || field.id === '';
    if (skip) return { field, skip, value: undefined, concept: null };
    return { field, skip, ...valueFor(field, profile, cfg) };
  });

  const batch: Array<{ key: string; value: string }> = [];
  for (const p of plans) {
    if (!p.skip && p.value !== undefined && batchable(p.field)) batch.push({ key: p.field.id, value: p.value });
  }
  const landed = await batchFillText(surface, cfg, batch);

  const outcome: FieldFillOutcome = { filledKnown: 0, freeform: [], guesses: [] };
  for (const { field, skip, value, concept } of plans) {
    if (skip) continue;
    if (value !== undefined) {
      if (landed.has(field.id)) {
        outcome.filledKnown += 1;
        continue;
      }
      if (concept !== null && EEO_CONCEPTS.has(concept) && (field.reactSelect || field.tag === 'select')) {
        const eeo = await eeoFill(surface, field, value, rs);
        if (eeo !== null) {
          outcome.filledKnown += 1;
          if (eeo !== 'filled') outcome.guesses.push(eeo);
          continue;
        }
      } else {
        const result = await fillScalar(surface, field, value, rs);
        if (result.ok) {
          outcome.filledKnown += 1;
          if (result.guess) outcome.guesses.push(result.guess);
          continue;
        }
      }
    }

    // Unfilled: consult the approved answer bank, then hand the rest to the
    // session so nothing is silently skipped — it decides per field whether to
    // fill, blank, or decline.
    const question = await openQuestionFor(surface, field, rs);
    const replay = await lookupApproved(question.label, question.options ?? []);
    if (replay !== null) {
      const result = await fillScalar(surface, field, replay.answer, rs);
      if (result.ok) {
        outcome.filledKnown += 1;
        if (!replay.exact) {
          outcome.guesses.push({ fieldKey: field.id, question: field.label, answer: replay.answer, reason: 'freeform' });
        } else if (result.guess) {
          outcome.guesses.push(result.guess);
        }
        continue;
      }
    }
    outcome.freeform.push(question);
  }
  return outcome;
}
