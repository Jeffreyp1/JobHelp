---
name: auto-apply
description: Fill a job application form in a real browser from the user's resume, standing profile, and answer bank, then park the tab for human review — it NEVER submits. Use when the user says "auto apply", "/auto-apply", "fill this application", "apply to these jobs", or gives job URLs or jobIds to apply to. ATS-agnostic (Greenhouse, Lever, Ashby, Workable, and others) via the Playwright MCP browser tools.
---

# Auto-Apply — AI-driven application fill (park, never submit)

Fill application forms end-to-end with the Playwright MCP `browser_*` tools in a
headful browser. Deterministic about safety, adaptive about everything else: read
the live page, do not rely on memorized selectors. JSON schemas are in
`reference.md` (same directory); field-interaction patterns and ATS quirks are in
`autoapply/playbook/field-playbook.md` — read both before the first job of a run.

## Hard rules (non-negotiable)

1. **NEVER submit.** Do not click Submit / Send / final Apply. On single-page
   forms, verify a button's purpose before clicking anything after filling; when
   unsure, don't click. The only buttons you may click are: cookie dismissal,
   apply-form reveal (only valid while no application fields are visible yet),
   dropdown/combobox open, "Add another" row expanders, boolean answer toggles
   (Yes/No buttons rendered directly under a question label, as on Ashby —
   verify a separate Submit button exists elsewhere first). Never call `browser_type`
   with `submit: true` and never press Enter in a form field — Enter submits many
   single-field forms.
2. **NEVER fabricate.** No invented employers, dates, degrees, metrics, skills, or
   authorizations. Every answer must trace to the profile, the resume, or an
   answer-bank entry. No truthful source → leave empty and flag.
3. **EEO/demographic fields** (gender, race, veteran, disability): answer only
   from explicit profile values. Absent → choose "Prefer not to say" / "Decline"
   when offered, else leave + flag.
4. **Signatures and attestations** ("I certify…", typed-signature boxes, legal
   acknowledgments): leave for the human, flag in the report.
5. **CAPTCHA visible** → record status `blocked` with reason, park, move on. Never
   attempt or wait out a captcha.
6. **Login or account-creation wall** → status `blocked`, skip the job.
7. **Never fill visually hidden fields** (honeypots) and never enter passwords.

## Inputs

`/auto-apply <args>` — args may contain, in any mix:
- **job URLs** — fill each. If no matching folder exists under
  `~/jobhelp/applications/`, create `~/jobhelp/applications/adhoc-<host>-<YYYY-MM-DD>/`.
  For ad-hoc URLs ask which resume to use unless the invocation says
  `using resume <path>`.
- **jobIds** — resolve URL and job folder via the jobhelp MCP (`get_job`,
  application state).
- **nothing** → "ready" jobs: folders in `~/jobhelp/applications/` that contain a
  tailored `resume.vN.md`/`.pdf` and have no `filled_parked` or `submitted` entry
  in `~/jobhelp/autoapply-status.json`.
- `batch N` — cap jobs this run (default **5**, to bound token spend; the cap
  applies to ready-jobs selection and to pasted URL/jobId lists alike).

Load once per run:
- Profile: `~/.config/jobhelp/autoapply-profile.json` (respect `JOBHELP_CONFIG_DIR`).
- Answer bank: `~/jobhelp/answer-bank.json` — create `{"entries": []}` if missing.

Per job, use the **highest version N present** in the job folder (`.md` or
`.pdf`). If that version has a `.pdf`, upload it; otherwise render its `.md` with
`node scripts/render-jakestyle.mts <resume.vN.md> <resume.vN.docx>` and upload
the DOCX. (Never upload an older `.pdf` when a newer `.md` exists.)

## Per-job flow

1. **Open** — open the job in a **new tab**: `browser_tabs` action `new` with
   the URL. Never `browser_navigate` to a new job — that replaces the previous
   job's parked, unsubmitted tab. Record the tab index for the summary. Dismiss
   cookie banners (only cookie-specific wording: "accept all cookies", "got
   it"). If no form is visible, click the Apply button/link once. Snapshot; if a
   login wall or captcha gates the form → `blocked`, next job.
2. **Survey** — `browser_snapshot`. Enumerate every form control with: label,
   kind (text / email / tel / url / textarea / native select / custom combobox /
   radio group / checkbox group / date / file), required?, options. If the page
   is not recognizably a job-application form (no application fields, no resume
   upload), do **not** type any profile data — status `blocked`, reason
   `not an application page`, next job.
3. **Resolve values** — sourcing order, first truthful hit wins:
   1. profile (names, contact, links, work authorization, sponsorship, EEO,
      education rows, location) — including labels matched via a
      `autoapply/overrides.json` labelRule, which resolve to profile concepts
      and count as profile-sourced;
   2. job context (company, role, profile `howHeard` default);
   3. **approved** answer-bank entry semantically matching the question — adapt
      company/role references, keep substance; the reused field is still marked
      `review: true` in the report. Unapproved entries may seed a draft but
      stay flagged;
   4. resume-derived draft (free-form/behavioral): read the job folder's
      `resume.vN.md`; pick the most relevant real experience; first person,
      ≤150 words; record provenance (file + which bullet);
   5. nothing truthful → leave empty, add to blockers.
4. **Fill** — apply each value using the patterns in `reference.md`. Re-snapshot
   only after interactions that re-render (combobox select, file upload, row
   adds) — not after every keystroke.
5. **Upload** — click the resume upload control to open the file chooser, then
   `browser_file_upload` with the absolute path (the tool acts on the open
   chooser — it takes only `paths`, it cannot target an element). Cover letter
   only if a distinct cover field exists AND the profile has `coverLetterPath`.
6. **Required check** — re-snapshot. Any required control still empty: retry
   resolution once; still empty → blocker.
7. **Double-check** — final `browser_snapshot` plus exactly **one**
   `browser_take_screenshot`. Verify: filled values stuck (hydration didn't
   reset them), each combobox shows its chosen option (not placeholder text),
   resume filename is attached, page title is unchanged (no accidental submit).
   Fix what's fixable; report the rest.
8. **Park + report** — write `<job dir>/autoapply-review.json` (schema in
   `reference.md`), update `~/jobhelp/autoapply-status.json` to `filled_parked`
   (or `blocked`/`failed` with reason). Leave the tab open.
9. **Learn** — append newly drafted free-form answers to the answer bank with
   `approved: false`. Then append one line to `~/jobhelp/autoapply-gaps.jsonl`
   for EVERY field left empty, flagged, or escalated this job (schema in
   `reference.md` — include the verbatim question, options, and a `reason`).
   This log feeds the automated improvement run; an unlogged gap can never be
   fixed.

## End of run

- Print a summary table: company · role · fields filled · drafted answers to
  review · blockers · tab.
- Report the run's per-job turn/tool-call counts (token cost itself comes from
  `/cost`, which the user runs — a session cannot read its own usage).
- List new answer-bank entries; ask which to approve; set `approved: true` on the
  ones the user confirms.
- Remind: each job sits in its own parked tab (`browser_tabs` action `list`
  enumerates them) — review each and click Submit yourself; closing the window
  discards unsubmitted fills.

## Statuses

`filled_parked` | `blocked` | `failed`. `blocked` = a gate prevented filling
(captcha, login, not an application page); `failed` = a tool or page error
stopped the fill partway. Never set `submitted` — that is the human's claim. A job already `filled_parked` or `submitted` is skipped (re-run is
idempotent); re-process only on explicit user request.
