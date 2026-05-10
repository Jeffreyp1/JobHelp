# Side panel — manual test checklist

UI components (tabs, layout, look & feel) are exempt from automated TDD per
spec section 6. The pure logic — cost calculator, preset manager, token
formatter, Job Insights card — IS covered by automated tests in
`extension/tests/lib/` and `extension/tests/sidepanel/jobInsightsCard.test.ts`.

This checklist is the manual gate for the rest.

## Tab navigation

- [ ] Loading the side panel shows the "Generate" tab by default.
- [ ] Clicking "Files" switches the visible content without a page reload.
- [ ] Clicking "Settings" switches the visible content without a page reload.
- [ ] The active tab button has a visible active state (underline + colour).
- [ ] `aria-selected="true"` appears on the active tab button.
- [ ] Tabs render correctly at 320px width (no horizontal scroll, no clipped
      buttons).

## Generate tab — Job Insights card

- [ ] When no scrape has run, card shows "No job detected" placeholder.
- [ ] After a successful scrape (mocked or real), the card displays:
      location, remote mode, salary range, years of experience, education.
- [ ] Required-skills section renders bars whose widths reflect skill counts
      (most frequent skill is widest).
- [ ] Nice-to-have skills appear under their own "Nice-to-have:" line.
- [ ] Visa = "no" surfaces "⚠ Sponsorship: not available" in the warn colour.
- [ ] Visa = "yes" surfaces "✓ Sponsorship: available" in the success colour.

## Generate tab — meta + JD

- [ ] Company / Role / URL fields are editable.
- [ ] Pasting JD text updates the live token count to the right.
- [ ] Token count is comma-separated (e.g. "2,847 tok").
- [ ] When a scrape arrives, JD textarea, Company, Role, URL all update from
      the scraper output.

## Generate tab — toggle UI

- [ ] "Generate Resume" is enabled by default with a Haiku 4.5 dropdown.
- [ ] Switching the dropdown to Sonnet 4.6 visibly updates the cost estimator.
- [ ] All other toggles (Research, Critique, Auto-revise, Multi-version,
      Cover letter, Verify CL hooks, LinkedIn benchmarking) are disabled.
- [ ] Disabled toggles show a grey "coming v2/v3/v4/v5" badge.
- [ ] Hovering a disabled toggle's badge shows a tooltip describing the v#.

## Generate tab — cost estimator

- [ ] Default state shows only "Generate" + Total.
- [ ] Total renders as USD with at least 3 decimals when below $1.
- [ ] Cost recomputes synchronously when the generate model changes.

## Generate tab — actions

- [ ] Clicking Generate sends a `generate_request` message via
      `chrome.runtime.sendMessage` (verify in DevTools Network/Console).
- [ ] After clicking Generate, the button is disabled and a status message
      appears next to it.
- [ ] On `generate_result`, the resume editor appears below with the
      resulting markdown pre-filled.
- [ ] The markdown preview updates live as the user edits the textarea.
- [ ] "Save & Log" button is wired to the `onSaveResume` callback.

## Files tab

- [ ] Source materials and Rule files appear as two distinct sections.
- [ ] Each row shows the filename, an approximate token count, and an
      "Open in Drive" button.
- [ ] Rules marked `load_bearing` show a small warn-coloured badge.
- [ ] "Sync from Drive" re-fetches both lists and disables itself while
      loading.
- [ ] Empty folders show "No files in this folder yet."
- [ ] An "Open in Drive" click opens the Drive view URL in a new tab.

## Settings tab

- [ ] All fields hydrate from `chrome.storage.local` on mount.
- [ ] Editing a field and blurring persists the value (verify via
      `chrome.storage.local.get(...)`).
- [ ] API key field uses `type="password"`.
- [ ] Default model dropdown lists Haiku 4.5 / Sonnet 4.6 / Opus 4.7.
- [ ] "Open source folder" / "Open rule files" open the Drive folder URL in a
      new tab when an ID is configured; show an alert when not.
- [ ] "Reset rules to defaults" prompts for confirmation before sending the
      `seed_defaults_request` message.
- [ ] "Run onboarding again" sends a `restart_onboarding` message.

## Cross-cutting

- [ ] Side panel renders cleanly at 320px, 360px, and 480px widths.
- [ ] No console errors at load.
- [ ] Light theme + dark theme both render readably (toggle macOS Appearance).
- [ ] Renders cleanly in Chrome 120+.

## Generate tab — finalize (Convert to PDF / DOCX)

- [ ] After a successful Generate, a "Convert to final format" section appears
      below the resume editor with two buttons: "Convert to PDF" and
      "Convert to DOCX".
- [ ] The finalize section is hidden (not present) before any generation runs.
- [ ] Editing the markdown in the resume editor textarea and then clicking
      "Convert to PDF" sends the EDITED text (not the original generated text)
      to the backend.
- [ ] Clicking "Convert to PDF" shows "Converting…" status, then on success
      shows "PDF saved → [Open tailored_resume.pdf]" as a clickable link.
- [ ] Clicking the "Open tailored_resume.pdf" link opens the file in a new tab.
- [ ] Clicking "Convert to DOCX" shows "Converting…" status, then on success
      shows "DOCX saved → [Open tailored_resume.docx]" as a clickable link.
- [ ] Both PDF and DOCX result rows accumulate in the status area (clicking
      both buttons shows two rows, one per format).
- [ ] A backend error response surfaces a user-readable inline error message
      (e.g. "Error: Cannot export: folder not found").
- [ ] If the Apps Script URL is not configured in Settings, clicking a finalize
      button shows "Error: Apps Script URL not configured. Check Settings."
- [ ] The finalize buttons are disabled while a conversion request is in flight
      (both buttons disabled until the current request resolves).
- [ ] Refreshing the panel (closing and reopening) clears the finalize section
      — a new Generate must be run before the buttons reappear.
- [ ] If the generate result's `docUrl` or `jobFolderUrl` cannot be parsed
      (no `/document/d/...` or `/folders/...` segment), the finalize buttons
      remain disabled with a tooltip explaining the issue.

## Open `index.html` directly (smoke test)

- [ ] `open extension/src/sidepanel/index.html` (or drag-drop into Chrome)
      shows tabs and a working Generate tab UI even without `chrome.*` APIs.
      The Files tab will show empty sections and Settings inputs will not
      hydrate; this is expected when running outside the extension context.
