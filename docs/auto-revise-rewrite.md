# Auto-revise rewrite

A rewrite of the extension's per-bullet / per-section revise flow. Branch `auto-revise-rewrite`, 19 commits, May 22 2026.

## Why

The previous flow sent the **whole resume** plus a `bulletId` to Claude. The id was computed client-side as a CRC32 over the bullet text and lived only as a DOM `data-*` attribute — it never appeared in the markdown the model received. So the model could not find the bullet, apologised in the response, and rewrote unrelated lines. The diff renderer then flagged every change as "outside requested scope" and the user saw a corrupted document with dozens of phantom edits.

Two compounding bugs:
- The model had no way to identify the target bullet inside the document it was given.
- The diff renderer trusted whatever the model returned, then post-flagged out-of-scope changes — relying on post-hoc validation of an untrusted full-document rewrite is fragile.

In parallel, the revise-instruction UI was `globalThis.prompt()` — the browser-native dialog, jarring next to the styled side panel.

## What changed

### Server (Apps Script)

New action `auto_revise_scoped` ([`extension-app/appsscript/src/handlers/autoReviseScoped.ts`](../extension-app/appsscript/src/handlers/autoReviseScoped.ts)) takes ONLY the in-scope text — one bullet line for `scope: "bullet"`, or one section's heading + bullets for `scope: "section"`. The model never sees content outside the excerpt, so byte equality of out-of-scope text is guaranteed by construction.

A two-agent flow runs inside the handler:
- **Creator**: rewrites the excerpt per the instruction. Output shape is tight (single line for bullet, JSON array of strings for section). Banned-word / structural rules injected.
- **Checker**: independently reviews the proposal against the original for fabrication, banned words, missing number-or-artifact, `-ing` analysis endings, forbidden openers. Returns `{ok, issues[]}`. On `ok: false`, the creator runs one more time with the issues appended; if it still fails, the proposal passes through with `checker.issues` populated so the UI can warn.

`whole-resume` continues to use the existing `auto_revise` handler unchanged — when the user explicitly asks for a global rewrite, byte-equality discipline doesn't apply.

### Client (extension)

A new pure library [`extension-app/extension/src/lib/anchor-replace.ts`](../extension-app/extension/src/lib/anchor-replace.ts) handles the line replacement locally. Functions:
- `findAnchorLine(lines, draftText, sectionName)` — locates a unique bullet within its section's heading scope. Throws on missing or non-unique.
- `applyBulletEdit(prev, draftText, sectionName, replaceWith)` — replaces the targeted line; preserves the leading `- ` marker; rejects multi-line replacements.
- `applySectionEdit(prev, sectionName, replaceBullets)` — replaces the bullet block under a `## Heading` wholesale.
- `validateByteEqualityOutsideEdits(prev, next, editedLineIndices, replacements)` — LCS-aligned diff walk with a per-replacement multiset budget. Defense-in-depth check that no line outside the edit site changed.

The orchestration lives in `runScopedRevise` in [`extension-app/extension/src/sidepanel/features/autoRevise.ts`](../extension-app/extension/src/sidepanel/features/autoRevise.ts): call the scoped API → apply the edit locally → run the byte-equality check → render an inline before/after diff with Accept/Reject. Checker findings (when present) surface as warning chips above Accept; the user can still accept.

### UI

The Edit/Preview tabs in the resume editor merged into a single click-to-edit view ([`resumeEditor.ts`](../extension-app/extension/src/sidepanel/components/resumeEditor.ts), now split into [`.parser.ts`](../extension-app/extension/src/sidepanel/components/resumeEditor.parser.ts) and [`.render.ts`](../extension-app/extension/src/sidepanel/components/resumeEditor.render.ts) for the 300-line cap). Clicking a bullet's text swaps it for an inline textarea; blur or Enter commits, Esc reverts. A collapsed `<details>` at the bottom exposes raw markdown for paste-in / large rewrites.

The `Revise` buttons next to bullets and `## ...` section headings now open an inline composer ([`reviseComposer.ts`](../extension-app/extension/src/sidepanel/components/reviseComposer.ts)) directly beneath the targeted element — replacing `globalThis.prompt()`. The composer is keyboard-driven (Enter to submit, Esc to cancel, Submit disabled while empty) and accessibility-labelled. The `revise role` button was dropped entirely; a user wanting to rewrite an entire role-block uses the parent `Revise section` instead.

## Tests

- `extension-app/extension/tests/lib/anchor-replace.test.ts` — 13 cases covering anchor location, replacement, and the multiset-budget byte-equality check.
- `extension-app/appsscript/tests/handlers/autoReviseScoped.test.ts` — 8 cases including the creator-fail-then-retry flow.
- `extension-app/extension/tests/sidepanel/components/reviseComposer.test.ts` — 7 cases for keyboard, accessibility, disabled-button.
- `extension-app/extension/tests/sidepanel/resumeEditor.test.ts` — 25 cases for click-to-edit, raw-markdown details, `setEditorMarkdown` event.
- `extension-app/extension/tests/sidepanel/features/autoRevise.test.ts` — 6 cases including the disconnected-slot race guard.

Full suite: 940 passing across 58 files.

## Deployment

The `extension-app/appsscript/dist/Code.gs` bundle is paste-deployed (it is gitignored on purpose — users copy its contents into their Apps Script web-app project and Save). The new `auto_revise_scoped` action is routed by `Code.ts`; after pulling this branch, run `node extension-app/appsscript/scripts/build.mts` and paste the new `Code.gs` into the deployed script before exercising the feature.

The extension bundles (`extension-app/extension/public/sidepanel/index.js`, `extension-app/extension/public/background.js`) are tracked in git and rebuilt as part of this branch.

## What is intentionally NOT in this rewrite

- Multi-bullet batch select-and-revise.
- Streaming partial replacements.
- Sub-section revise (a `### role-heading` block beneath a `## section` — the new scope set is bullet / section / whole-resume only).
- Fancy diff syntax highlighting.

## Files

Source of truth for the design and plan:
- [`docs/superpowers/specs/2026-05-22-extension-auto-revise-rewrite-design.md`](./superpowers/specs/2026-05-22-extension-auto-revise-rewrite-design.md)
- [`docs/superpowers/plans/2026-05-22-extension-auto-revise-rewrite.md`](./superpowers/plans/2026-05-22-extension-auto-revise-rewrite.md)
