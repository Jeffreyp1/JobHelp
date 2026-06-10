# jobhelp-autoapply

A standalone Playwright CLI that fills job applications from the jobs and tailored
resumes the JobHelp MCP already wrote to `~/jobhelp`. It opens each ready job in
its own browser tab, fills every field it has a deterministic answer for, uploads
the resume, and **parks the tab for you to review and submit** — with an opt-in
flag to auto-submit once you trust it.

Supported ATSs (an adapter is picked automatically from the job URL):
**Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Recruitee**. All six run on
one shared form engine; adding another ATS is a small config in `src/ats/`.

It makes **no LLM calls** and needs no API key. Open-ended essay questions are
handed to the driving Claude session via JSON files (see Freeform below).

## How it fits in

```
JobHelp MCP  ──writes──▶  ~/jobhelp/applications/<slug>/   ──read──▶  jobhelp-autoapply
 (discovers jobs,          (job url in state.json,                    (fills the form in
  tailors resume)           resume.vN.md)                              a real browser)
```

This tool only reads files on disk. It does not start or call the MCP server, and
it is **not** a Playwright MCP — it uses the Playwright library directly.

## Requirements

- Node 25+ (runs TypeScript directly; no build step).
- `npm install` then `npx playwright install chromium`.
- A standing-answers profile at `~/.config/jobhelp/autoapply-profile.json`.
- The MCP must have already produced per-job folders with a supported-ATS `url`
  (Greenhouse / Lever / Ashby / Workable / SmartRecruiters / Recruitee) and a
  `resume.vN.md`.

## Standing-answers profile

`~/.config/jobhelp/autoapply-profile.json` — every value is a plain string. Keys
are the recognized field concepts; include the ones that apply to you:

```json
{
  "firstName": "Ada",
  "lastName": "Lovelace",
  "fullName": "Ada Lovelace",
  "email": "ada@example.com",
  "phone": "555-0100",
  "location": "London, UK",
  "linkedin": "https://www.linkedin.com/in/ada",
  "github": "https://github.com/ada",
  "portfolio": "https://ada.dev",
  "website": "https://ada.dev",
  "workAuthorization": "Yes",
  "sponsorship": "No",
  "gender": "Prefer not to say",
  "race": "Prefer not to say",
  "veteranStatus": "Prefer not to say",
  "disabilityStatus": "Prefer not to say",
  "howHeard": "Company website"
}
```

A config path override is honored via `JOBHELP_CONFIG_DIR`; state/home via
`JOBHELP_HOME`.

## Usage

```bash
# Fill up to 8 ready jobs, park each tab for review (default, safe):
npm start

# Options:
node src/cli.ts --batch 5            # cap how many jobs this run
node src/cli.ts --job <jobId>        # one specific job only
node src/cli.ts --dry-run            # fill but never submit, then close
node src/cli.ts --headless           # no visible window (for fixtures/CI)
node src/cli.ts --auto-submit        # opt in to clicking Submit (see gating)
node src/cli.ts --freeform-timeout 120   # wait up to 120s for essay answers
```

Default is **headful** (a visible window) and **park-for-review** (never submits).
When parked, the window stays open; review each tab and click Submit yourself.

> Keep the browser open until you have submitted. These forms hold typed answers
> only in the live tab — closing the window before submitting loses unsubmitted
> fills, and you would re-run.

## Submit gating

`--auto-submit` clicks Submit only when **all** of these hold for a job:

- the run has `--auto-submit` and is not `--dry-run`,
- the resume upload attached,
- no required field is still empty,
- no captcha is present.

Any of those failing forces the job to **pause** for you instead — auto-submit
never overrides a hard stop.

## Freeform (essay) questions

For questions with no standing answer ("Why do you want to work here?", "Tell me
about a time you…"), the tool:

1. writes `freeform-questions.json` into the job's `~/jobhelp` folder and pauses,
2. expects the driving Claude session to write `freeform-answers.json`
   (`{ "<fieldKey>": "<answer>" }`) grounded in your resume — truthful, not fake,
3. on the next pass (or within `--freeform-timeout`) fills those answers and
   records them in `autoapply-review.json` as **guesses to double-check**.

Only guessed fields are flagged for review; deterministic fields are not.

## Status & review

- `~/jobhelp/autoapply-status.json` — per-job status
  (`queued` → `converted` → `filled` | `needs_freeform` | `submitted` | `failed`).
  A `submitted` job is never processed again.
- `<job dir>/autoapply-review.json` — the guessed answers for that job.
- End of run: a summary listing each application and how many guesses to check.

## Resume conversion

The resume is converted from `resume.vN.md` to `resume.autoapply.docx` via the
repo's `scripts/render-jakestyle.mts` (shelled out behind the `ResumeConverter`
seam). That script must exist at the repo root at runtime. DOCX only for now;
PDF can be added later. All supported ATSs accept DOCX uploads.

## Adapters

Each ATS is a thin config in `src/ats/` over a shared engine
(`make-ats.ts` + `form-dom.ts` + `react-select.ts`). A config declares the URL
pattern, the form selector, the submit button, and a field-detection strategy;
the open/fill/validate/submit behavior is shared.

| ATS | URL host | Field detection | Notes |
|-----|----------|-----------------|-------|
| Greenhouse | `*.greenhouse.io` | `label[for]` | also handles the embedded-iframe form |
| Lever | `*.lever.co` | control-first | server-rendered; named inputs + `.application-question` |
| Ashby | `jobs.ashbyhq.com` | control-first | SPA; value-retaining comboboxes, aria-required groups |
| Workable | `*.workable.com` | control-first | SPA; classic react-select dropdowns |
| SmartRecruiters | `*.smartrecruiters.com` | control-first | labelled form, native selects |
| Recruitee | `*.recruitee.com` | control-first | labelled candidate form + custom questions |

Every adapter is covered by a Playwright fixture test (`tests/*.fixture.test.ts`)
that exercises fill / validate / freeform handoff against a realistic HTML fixture
and **never submits live**. The five non-Greenhouse adapters were built from each
ATS's known DOM shape; their selectors are **fixture-validated, not yet verified
against live pages** — so browser-test each once before trusting `--auto-submit`.

## Browser-testing a new adapter

The fixtures prove the logic; a real page proves the selectors. For each ATS:

```bash
# 1. Point at a real posting + a job dir that has a resume.vN.md, then dry-run
#    headful so you watch it fill but it never submits:
node src/cli.ts --job <jobId> --dry-run

# 2. Or fill-and-park (default) and inspect each field before submitting yourself:
node src/cli.ts --job <jobId>
```

What to confirm in the window: the standard fields (name/email/phone/links) land,
the resume attaches, dropdowns resolve to the right option, and required
essays/choices are flagged (not silently skipped). If a field is missed, the fix
is almost always the adapter's `formSelector` or a detection tweak in
`src/ats/<ats>.ts` — no engine change.

## Tests

```bash
npm test        # vitest: pure units + Playwright fixtures (never submits live)
npm run typecheck
```
