# Auto-Apply reference — interaction patterns and schemas

## Field-type playbook

| Control | How to fill | Verify |
|---|---|---|
| text / email / tel / url | `browser_type` into the field | value present in next snapshot |
| textarea | `browser_type` the full drafted answer | value present |
| native select | `browser_select_option` with the option matching the truthful value | selected option text |
| custom combobox (react-select style, `role="combobox"`) | click the control → type a filter string → snapshot → click the matching option from the listbox | control now shows the chosen text, not a placeholder |
| async autocomplete (school, company, location) | type the query → wait for options to render → pick the closest option that is factually true; none true → leave + flag | chosen text shown |
| radio group | click the option matching the sourced value; no truthful match → flag, do not guess | `checked` in snapshot |
| checkbox group | check every option that is factually true (multi allowed); consent-to-contact boxes only when factual | checked states |
| date | type in the placeholder's format; if a picker blocks typing, click through it | value present |
| file | click the upload control to open the file chooser, then `browser_file_upload` with the absolute path (it acts on the open chooser; it cannot target an element) | filename appears near the field |
| "Add another" rows (education etc.) | click the expander until row count matches profile entries, then fill rows by index | row count |
| hidden / `display:none` / zero-size inputs | **never fill** (honeypots) | — |

Quirks worth expecting: hydration can wipe early fills (fill after the page is
stable; the double-check pass catches stragglers); some forms re-render after
file upload (re-snapshot before touching anything else); a combobox that shows
typed text is NOT selected until an option was clicked.

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

## Review report — `<job dir>/autoapply-review.json`

```json
{
  "company": "Acme",
  "role": "Software Engineer",
  "url": "https://…",
  "filledAt": "2026-06-09T20:15:00Z",
  "fields": [
    { "label": "Email", "value": "ada@example.com", "source": "profile", "review": false },
    { "label": "Why this role?", "value": "…", "source": "drafted",
      "provenance": "resume.v3.md: …", "review": true }
  ],
  "blockers": ["Signature box left for you"],
  "screenshotNote": "final state verified; no resets observed"
}
```

`source` ∈ `profile | job-context | answer-bank | drafted`. `review: true` for
every answer-bank and drafted value, and for any fuzzy dropdown pick.

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

## Fixture testing (local, no real applications)

```bash
cd ~/JobHelp/tests/autoapply-fixtures && python3 -m http.server 8765
```

Then run e.g.:
`/auto-apply http://localhost:8765/greenhouse-required.html using resume /tmp/aa-fixture-job/resume.v1.pdf`

Pass criteria per page: all required fields filled or flagged; the page title
never becomes `SUBMIT-FIRED`; a review report and status entry are written; the
answer bank grows only for drafted free-form answers.
