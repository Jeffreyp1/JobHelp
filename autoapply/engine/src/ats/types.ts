import type { Page } from 'playwright';
import type { FreeformQuestion, GuessedField, StandingProfile } from '../types.ts';

export type { FreeformQuestion };

export interface FillOutcome {
  readonly filledKnown: number;
  readonly freeform: readonly FreeformQuestion[];
  /** Dropdowns whose typed value didn't match exactly and were resolved to the
   * closest available option — recorded so the user reviews them. */
  readonly guesses: readonly GuessedField[];
  readonly resumeUploaded: boolean;
}

export interface ValidationOutcome {
  readonly ok: boolean;
  readonly blockers: readonly string[];
  readonly captcha: boolean;
}

export interface Ats {
  readonly name: string;
  matches(url: string): boolean;
  openForm(page: Page, url: string): Promise<void>;
  fill(page: Page, profile: StandingProfile, resumeFilePath: string): Promise<FillOutcome>;
  /** Apply session answers; resolves to the fieldKeys that VERIFIABLY landed. */
  applyFreeform(page: Page, answers: Record<string, string>): Promise<readonly string[]>;
  validate(page: Page): Promise<ValidationOutcome>;
  submit(page: Page): Promise<void>;
}
