/**
 * Turns scanned fields + the user's profile into a fill plan, and applies the
 * fills to the live DOM. Splitting "decide" (planAutofill, pure) from "do"
 * (applyFills, the only DOM-mutating function) keeps the logic unit-testable.
 *
 * v1 only auto-fills plain text inputs it has a profile value for. Files,
 * react-select comboboxes, unknown questions, and known-but-empty fields are
 * routed to the review list rather than guessed — the user (or a later AI step)
 * handles those.
 */
import { scanForm, type FormField } from './scanForm.js';
import { classifyField, type FieldConcept } from './classify.js';
import type { SchoolEntry } from './profile.js';

/** Flat standing answers, keyed by the concept each fills. */
export type ProfileScalars = Partial<Record<FieldConcept, string>>;

/** The full stored profile: scalar answers plus a structured schools list. */
export interface ApplicationProfile extends ProfileScalars {
  schools?: SchoolEntry[];
}

export interface FillAction {
  id: string;
  value: string;
}

export type ReviewReason = 'file' | 'unknown' | 'combobox' | 'no-value';

export interface ReviewItem {
  id: string;
  label: string;
  reason: ReviewReason;
}

export interface AutofillPlan {
  /** Plain text/textarea fields to set directly. */
  fills: FillAction[];
  /** react-select comboboxes we have a value for — attempt auto-select. */
  comboFills: FillAction[];
  /** Fields left for the user (files, valueless comboboxes, unknowns, empties). */
  review: ReviewItem[];
}

export function planAutofill(
  fields: readonly FormField[],
  profile: ProfileScalars,
): AutofillPlan {
  const fills: FillAction[] = [];
  const comboFills: FillAction[] = [];
  const review: ReviewItem[] = [];
  for (const field of fields) {
    if (field.type === 'file') {
      review.push({ id: field.id, label: field.label, reason: 'file' });
      continue;
    }
    const concept = classifyField(field);
    if (!concept) {
      review.push({ id: field.id, label: field.label, reason: 'unknown' });
      continue;
    }
    const value = profile[concept];
    if (field.combobox) {
      if (value) comboFills.push({ id: field.id, value });
      else review.push({ id: field.id, label: field.label, reason: 'combobox' });
      continue;
    }
    if (!value) {
      review.push({ id: field.id, label: field.label, reason: 'no-value' });
      continue;
    }
    fills.push({ id: field.id, value });
  }
  return { fills, comboFills, review };
}

/** One-line summary for the on-page panel after a run. */
export function reviewSummary(applied: number, review: readonly ReviewItem[]): string {
  const filled = `Filled ${applied} field${applied === 1 ? '' : 's'}`;
  if (review.length === 0) return `${filled}. Nothing left for you.`;
  return `${filled}. ${review.length} still need you.`;
}

export interface AutofillRun {
  /** How many text fields were filled directly in the DOM. */
  applied: number;
  /** Comboboxes with a value — the caller drives async react-select selection. */
  comboFills: FillAction[];
  /** Fields left for the user (files, valueless comboboxes, unknowns, empties). */
  review: ReviewItem[];
}

/** Scan the page, plan from the profile, apply the synchronous text fills. The
 * combobox auto-select is async/DOM-specific, so it is returned for the content
 * script to drive (see combobox.fillCombobox). */
export function runAutofill(root: Document, profile: ProfileScalars): AutofillRun {
  const plan = planAutofill(scanForm(root), profile);
  return {
    applied: applyFills(plan.fills, root),
    comboFills: plan.comboFills,
    review: plan.review,
  };
}

export function applyFills(fills: readonly FillAction[], root: Document): number {
  let applied = 0;
  for (const fill of fills) {
    const el = root.getElementById(fill.id);
    if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement)) continue;
    el.value = fill.value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    applied += 1;
  }
  return applied;
}
