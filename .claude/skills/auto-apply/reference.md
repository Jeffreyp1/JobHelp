# Auto-Apply reference — schemas and pointers

## Field-type playbook

Lives at `autoapply/playbook/field-playbook.md` — read it alongside this file
before the first job of a run. It is learnable knowledge inside the
self-updater's writable folder; this reference file and SKILL.md are not.

## Learned mappings — `autoapply/overrides.json`

`labelRules` map recurring question labels to existing profile concepts; a match
counts as profile-sourced in the sourcing order:

```json
{"labelRules": [{"pattern": "preferred pronouns?", "flags": "i",
  "concept": "pronouns", "ats": null, "addedAt": "2026-06-14",
  "evidence": ["3 gaps: sony, writer, loop"]}]}
```

A rule may only point at a concept that exists in the standing profile. Personal
VALUES never live here — they stay in the profile, which the updater cannot write.

## Answer bank — `~/jobhelp/answer-bank.json`

```json
{
  "entries": [
    {
      "id": "ab-2026-06-09-001",
      "question": "Tell us about a challenge you faced",
      "tags": ["behavioral", "challenge"],
      "answer": "…",
      "provenance": ["resume.v3.md: Simulation pipeline migration bullet"],
      "approved": false,
      "usedCount": 2,
      "lastUsedAt": "2026-06-09",
      "companySpecific": false
    }
  ]
}
```

- Matching is semantic — judge whether the stored question and the form's
  question ask the same thing; do not regex-match.
- `companySpecific: true` entries ("Why do you want to work at X?") are reused
  as structure only — rewrite the substance for the new company, never paste.
- Only `approved: true` entries count as a trusted source; unapproved ones may
  seed a draft but the field stays flagged for review.
- Increment `usedCount` / set `lastUsedAt` on reuse.
- Read-modify-write the whole file; preserve entries you didn't touch.

## Review artifact — `<job dir>/autoapply-review.json` (schemaVersion 2)

One canonical shape, written by BOTH the engine and this skill (the engine's
`review-artifact.ts` is the source of truth; its reader tolerates the two
pre-v2 legacy shapes):

```json
{
  "schemaVersion": 2,
  "jobId": "acme-software-engineer-2026-06-05",
  "company": "Acme",
  "role": "Software Engineer",
  "url": "https://…",
  "filledAt": "2026-06-09T20:15:00Z",
  "verdict": "review",
  "green": 9,
  "captcha": false,
  "blockers": ["Signature box left for you"],
  "fields": [
    { "fieldKey": "email", "question": "Email", "value": "ada@example.com",
      "source": "profile", "required": true },
    { "fieldKey": "sponsor", "question": "Need sponsorship?", "value": "No",
      "source": "answer-bank", "exact": true, "options": ["Yes", "No"] },
    { "fieldKey": "why", "question": "Why this role?", "value": "…",
      "source": "drafted", "reason": "freeform", "provenance": "resume.v3.md: …" }
  ],
  "notes": ["final state verified; no resets observed"]
}
```

- `fields` records EVERY filled control: `source` ∈ `profile | job-context |
  answer-bank | drafted | guessed`; `exact: true` only for an answer-bank replay
  whose option set matched byte-for-byte; `reason` (`freeform | dropdown`) on
  reviewable entries; `provenance` on drafted answers (resume file + bullet).
- Reviewable (the old `review: true`) is derived, not stored: `drafted`,
  `guessed`, or `answer-bank` without `exact: true`.
- `verdict` ∈ `ready | review | blocked`; `green` = count of non-reviewable
  fields; `blockers` = required fields left for the human.
- A `verifier` block (per-run) and per-field `verifier` verdicts are added by
  the answer-verification pass when it runs; absence means unverified.

## Status sidecar — `~/jobhelp/autoapply-status.json`

Object keyed by job folder slug (or the URL for ad-hoc jobs):

```json
{
  "acme-software-engineer-2026-06-05": {
    "status": "filled_parked",
    "updatedAt": "2026-06-09T20:15:00Z",
    "url": "https://…",
    "reason": null
  }
}
```

Read-modify-write the whole file; preserve entries you didn't touch. `reason` is
set for `blocked` (e.g. `"captcha"`, `"login required"`) and `failed`.

## Gaps log — `~/jobhelp/autoapply-gaps.jsonl`

Append-only, one JSON object per line, one line per unfilled/flagged field:

```json
{"ts": "2026-06-10T08:52:00Z", "ats": "ashby", "company": "WRITER",
 "jobSlug": "writer-software-engineer-connectors-mcp-2026-06-05", "url": "https://...",
 "question": "What percentage of your day do you spend hands-on coding?",
 "fieldKind": "radio", "options": ["0%", "25%", "50%", "75%", "100%"],
 "required": true, "reason": "no-standing-answer", "filledBy": "none", "notes": ""}
```

`reason` is one of: `no-standing-answer` (personal fact absent from profile),
`no-truthful-option` (options list had no truthful choice), `unrecognized-widget`
(couldn't operate the control), `adapter-miss` (CLI failed, AI recovered —
set `filledBy: "ai-after-cli-miss"`), `consent-or-signature` (policy: never
auto-completed), `captcha`, `login-wall`. Record the question verbatim — the
weekly improver clusters on it.

## Fixture testing (local, no real applications)

```bash
cd ~/JobHelp/autoapply/fixtures && python3 -m http.server 8765
```

Then run e.g.:
`/auto-apply http://localhost:8765/greenhouse-required.html using resume ~/JobHelp/applications/<slug>/resume.vN.pdf`
(the resume must live under the project root — `/tmp` is outside the MCP's
allowed upload roots)

Pass criteria per page: all required fields filled or flagged; the page title
never becomes `SUBMIT-FIRED`; a review report and status entry are written; the
answer bank grows only for drafted free-form answers.
