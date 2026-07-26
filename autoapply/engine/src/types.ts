export type ApplyStatus =
  | 'queued'
  | 'converted'
  | 'filled'
  // Written by the skill layer, and by the engine when the pause gate parks the
  // tab for human review. Never re-queued — the human may already have submitted
  // from the parked tab.
  | 'filled_parked'
  | 'needs_freeform'
  | 'paused'
  | 'prefilled'
  // Written by the skill layer: a blocker (captcha, login wall, ...) stopped the
  // fill; a human must clear it before the job can move.
  | 'blocked'
  | 'submitted'
  // Clicked submit but no success signal appeared. Terminal and NOT retried (the
  // send may have gone through); surfaced for the user to confirm manually.
  | 'submitted_unverified'
  | 'failed';

/** A sidecar record whose status string the engine doesn't recognize (vocabulary
 * drift between skill and engine). Fail-safe: the queue skips it — an unknown
 * status could mean "already submitted". */
export interface QuarantinedStatusRecord {
  readonly jobId: string;
  readonly status: 'quarantined';
  readonly rawStatus: string;
  readonly updatedAt: string;
}

export interface ReadyJob {
  readonly jobId: string;
  readonly company: string;
  readonly role: string;
  readonly url: string;
  readonly dir: string;
  readonly resumeMdPath: string;
}

export type QuestionKind = 'text' | 'textarea' | 'select';

/** A field the tool couldn't fill deterministically, handed to the session to
 * answer. `options` is present for fixed-list dropdowns so the session picks one. */
export interface FreeformQuestion {
  readonly fieldKey: string;
  readonly label: string;
  readonly kind: QuestionKind;
  readonly options?: readonly string[];
}

export interface GuessedField {
  readonly fieldKey: string;
  readonly question: string;
  readonly answer: string;
  readonly reason: 'freeform' | 'dropdown';
}

/** A field in the human review, tagged by confidence tier. */
export interface ReviewField {
  readonly field: string;
  readonly answer?: string;
  readonly why: string;
}

export type ReviewVerdict = 'ready' | 'review' | 'blocked';

/** The per-job review, tiered so the user can scan it: green = deterministic
 * fills to trust, yellow = best-guess answers to double-check, red = required
 * fields still blank. The verdict is the at-a-glance call. */
export interface ReviewReport {
  readonly verdict: ReviewVerdict;
  readonly green: number;
  readonly yellow: readonly ReviewField[];
  readonly red: readonly ReviewField[];
  readonly captcha: boolean;
  /** Run-level caveats the human must see before submitting (e.g. the renderer
   * trimmed resume bullets to fit one page). Present only when non-empty. */
  readonly notes?: readonly string[];
}

export interface StatusRecord {
  readonly jobId: string;
  readonly status: ApplyStatus;
  readonly updatedAt: string;
  readonly error?: string;
  readonly resumeDocxPath?: string;
  readonly guessed?: readonly GuessedField[];
}

/** Single source of truth for profile/classification concepts: the FieldConcept
 * union, the loadProfile whitelist, and the learned-override validator all
 * derive from this array so they can never diverge. */
export const FIELD_CONCEPTS = [
  'firstName',
  'lastName',
  'fullName',
  'email',
  'phone',
  'location',
  'locationCity',
  'state',
  'country',
  'linkedin',
  'github',
  'portfolio',
  'website',
  'workAuthorization',
  'sponsorship',
  'citizenship',
  'relocation',
  'onsiteAvailability',
  'expectedSalary',
  'desiredSalaryPolicy',
  'priorEmploymentAtCompany',
  'relativesAtCompany',
  'percentHandsOnCoding',
  'acknowledgePrivacyNotices',
  'gender',
  'genderIdentity',
  'pronouns',
  'sexualOrientation',
  'race',
  'veteranStatus',
  'disabilityStatus',
  'howHeard',
  'educationStartMonth',
  'educationEndMonth',
] as const;

export type FieldConcept = (typeof FIELD_CONCEPTS)[number];

export interface EducationEntry {
  readonly school: string;
  readonly degree: string;
  readonly discipline: string;
  readonly startYear: string;
  readonly endYear: string;
  readonly startMonth?: string;
  readonly endMonth?: string;
}

export type ProfileScalars = Partial<Record<FieldConcept, string>>;

export interface StandingProfile extends ProfileScalars {
  readonly education?: readonly EducationEntry[];
  readonly coverLetterPath?: string;
}

export interface McpApplicationEntry {
  readonly jobId: string;
  readonly company: string;
  readonly role: string;
  readonly date: string;
  readonly dir: string;
  readonly url?: string;
  readonly location?: string;
  readonly updatedAt: string;
}

export interface McpState {
  readonly applications: readonly McpApplicationEntry[];
}
