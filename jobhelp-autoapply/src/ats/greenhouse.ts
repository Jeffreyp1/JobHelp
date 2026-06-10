import type { Ats } from './types.ts';
import type { AtsConfig, DetectedField, Surface } from './form-config.ts';
import type { EducationEntry, StandingProfile } from '../types.ts';
import { formScope } from './form-dom.ts';
import { detectControls } from './detect-controls.ts';
import { makeAts } from './make-ats.ts';

/** Education rows use ids like school--0 / degree--0 / start-year--0. */
export const EDUCATION_FIELD_RE = /^(school|degree|discipline|start-year|end-year)--(\d+)$/;

function eduValue(kind: string, e: EducationEntry): string {
  switch (kind) {
    case 'school': return e.school;
    case 'degree': return e.degree;
    case 'discipline': return e.discipline;
    case 'start-year': return e.startYear;
    default: return e.endYear;
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Click "Add another" until the education section has `desired` rows. Verifies
 * each click actually added a school row, so it ignores unrelated "Add another"
 * links (e.g. work experience) and stops if none adds a row. */
async function ensureEducationRows(surface: Surface, desired: number, cfg: AtsConfig): Promise<void> {
  const form = await formScope(surface, cfg);
  const schools = form.locator('[id^="school--"][role="combobox"]');
  let stale = 0;
  while ((await schools.count()) < desired && stale < 3) {
    const before = await schools.count();
    const adds = form.locator('a, button').filter({ hasText: /add another/i });
    const n = await adds.count();
    if (n === 0) return;
    for (let i = 0; i < n; i += 1) {
      if ((await schools.count()) >= desired) break;
      await adds.nth(i).scrollIntoViewIfNeeded().catch(() => undefined);
      await adds.nth(i).click().catch(() => undefined);
      await sleep(500);
    }
    stale = (await schools.count()) <= before ? stale + 1 : 0;
  }
}

export const greenhouseConfig: AtsConfig = {
  name: 'greenhouse',
  urlRe: /greenhouse\.io|boards\.greenhouse/i,
  formSelector: 'form#application_form, form#application-form, form[id*="application"]',
  iframeSelector: 'iframe#grnhse_iframe, iframe[src*="greenhouse"]',
  submitSelector: '#submit_app, button[type="submit"], input[type="submit"]',
  detect: detectControls,
  async beforeFill(surface, profile, cfg) {
    if (profile.education && profile.education.length > 1) {
      await ensureEducationRows(surface, profile.education.length, cfg);
    }
  },
  resolveValue(field: DetectedField, profile: StandingProfile): string | undefined {
    const edu = EDUCATION_FIELD_RE.exec(field.id);
    if (!edu) return undefined;
    const entry = profile.education?.[Number(edu[2])];
    return entry ? eduValue(edu[1] ?? '', entry) : undefined;
  },
};

export const greenhouse: Ats = makeAts(greenhouseConfig);
