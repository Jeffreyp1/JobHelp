# Field-type playbook (learnable knowledge — maintained by /auto-apply-update)

This file is inside `autoapply/`, the self-updater's writable folder. Safety rules
live in `.claude/skills/auto-apply/SKILL.md` and are NOT here by design.

## How to fill each control

| Control | How to fill | Verify |
|---|---|---|
| text / email / tel / url | `browser_type` into the field | value present in next snapshot |
| textarea | `browser_type` the full drafted answer | value present |
| native select | `browser_select_option` with the option matching the truthful value | selected option text |
| custom combobox (react-select style, `role="combobox"`) | click the control → type a filter string → snapshot → click the matching option from the listbox | control now shows the chosen text, not a placeholder |
| async autocomplete (school, company, location) | type the query → wait for options to render → pick the closest option that is factually true; none true → leave + flag | chosen text shown |
| radio group | click the option matching the sourced value; no truthful match → flag, do not guess | `checked` in snapshot |
| checkbox group | check every option that is factually true (multi allowed); consent-to-contact boxes only when factual | checked states |
| boolean answer toggle (Yes/No buttons under a question label, e.g. Ashby) | click the truthful option; verify a separate Submit button exists elsewhere first | selected styling / DOM class |
| date | type in the placeholder's format; if a picker blocks typing, click through it | value present |
| file | click the upload control to open the file chooser, then `browser_file_upload` with the absolute path (it acts on the open chooser; it cannot target an element) | filename appears near the field |
| "Add another" rows (education etc.) | click the expander until row count matches profile entries, then fill rows by index | row count |
| hidden / `display:none` / zero-size inputs | **never fill** (honeypots) | — |

## Quirks worth expecting

- Hydration can wipe early fills — fill after the page is stable; the double-check
  pass catches stragglers.
- Some forms re-render after file upload — re-snapshot before touching anything else.
- A combobox that shows typed text is NOT selected until an option was clicked.
- After typing into a combobox with no matching truthful option, clear the typed
  filter text before moving on.
- `browser_file_upload` only accepts paths inside the Playwright MCP's allowed
  roots (the project directory by default) and compares the path string
  case-sensitively — reference resumes via the exact-cased project path
  (`~/JobHelp/applications/...`, not `~/jobhelp/...`).
- Greenhouse intl phone widgets reformat the number after country selection —
  verify the digits survived, don't re-type.

## Per-ATS notes

- **greenhouse** (job-boards.greenhouse.io): EEO dropdowns are custom comboboxes
  with a decline option ("Decline To Self Identify" / "I don't wish to answer" /
  "I do not want to answer" — wording varies per question). Invisible reCAPTCHA
  badge is NOT a blocking captcha; only a challenge widget is.
- **ashby** (jobs.ashbyhq.com): application lives behind an "Apply for this Job"
  tab reveal; booleans are Yes/No button toggles; no `<form>` element on the
  application route.
