# Changelog

All notable changes to JobHelp are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.2] - 2026-05-11

v2.1 setup-simplification scaffold + observability + multiple silent-failure fixes surfaced by an audit + black-box / smoke test pass.

### Added (setup simplification — v2.1 milestone)

- **Drive config file backend.** New Apps Script action [`create_drive_file`](appsscript/src/handlers/createDriveFile.ts) writes a file to the user's Drive (root or specified folder). Used by the side-panel onboarding wizard to scaffold `jobhelp-config.json` ([D1]).
- **Settings tab rewrite.** Replaces 8 separate inputs with one "JobHelp config file ID" field + Reload / Open-in-Drive / Migrate / Run-onboarding controls. Diagnostic block masks the API key (`sk-ant-...XXXX`) ([D2]).
- **Onboarding wizard.** First-run modal walks through: Welcome → Create config → Open in Drive → Validate file ID ([D2]).
- **Storage schema shrink + legacy migration.** [`extension/src/types/storage-schema.ts`](extension/src/types/storage-schema.ts) gained `jobhelpConfigFileId` as primary key; 8 v0.2.0 keys marked `@deprecated` (still typed for back-compat). New [`extension/src/lib/configMigration.ts`](extension/src/lib/configMigration.ts) exports `hasLegacySettings`, `buildConfigFromLegacy`, `clearLegacySettings` (19 tests) ([D3]).
- **Security model + optional API-key encryption.** New [`docs/security.md`](docs/security.md) (2,138 words; 6 sections) documenting threat scenarios, recommended Drive ACLs, multi-user posture. New [`extension/src/lib/configCrypto.ts`](extension/src/lib/configCrypto.ts) — AES-GCM 256 + PBKDF2-SHA256 @ 600K iterations; 16 tests covering round-trip, tampering, wrong passphrase, Unicode, 10 KB payloads ([D4]).
- **End-user setup guide.** [`docs/setup-for-new-users.md`](docs/setup-for-new-users.md) (2,000 words) — step-by-step for a fresh install, including multi-machine + troubleshooting ([D5]).

### Added (observability + testing)

- **Structured logger with redaction.** [`appsscript/src/lib/structuredLog.ts`](appsscript/src/lib/structuredLog.ts) + [`extension/src/lib/structuredLog.ts`](extension/src/lib/structuredLog.ts). Auto-redacts: keys matching `/api[-_]?key|token|secret|password|authorization/i`, values matching `sk-ant-[a-zA-Z0-9_-]{20,}`, strings >2 KB. Extension version exports `getRecentLogs()` ring buffer (last 100 entries). Wired into nothing yet — follow-up commits adopt it ([T4]).
- **Silent-failure audit.** [`docs/superpowers/reviews/silent-failure-audit.md`](docs/superpowers/reviews/silent-failure-audit.md) (~33 KB) — comprehensive review of every swallowed error, fallback-mask, and validation gap across the codebase ([T4]).
- **Black-box contract tests.** New [`tests/contracts/`](tests/contracts/) directory — 45 tests across `generate.contract`, `v2-features.contract`, `errors.contract` verifying wire shapes against the typed `ApiResult<T>` envelope. Surfaced 2 real handler bugs (see Fixed) and 3 contract ambiguities (multi-version `count` type vs validator bounds; verify-hooks `sources` required-but-defaulted; `sheetId`/`rowUrl` field is dead-letter on multi-version) ([T2]).
- **Smoke harness.** [`scripts/verify-bundle.mjs`](scripts/verify-bundle.mjs) runs both build pipelines + 12 post-build checks (size limits, manifest schema, presence of all 15 `VALID_ACTIONS` strings in `Code.gs`, version match between manifest and CHANGELOG). [`scripts/smoke-test.mjs`](scripts/smoke-test.mjs) chains it + an optional `APPS_SCRIPT_URL` ping. 2 vitest cases in [`tests/smoke/`](tests/smoke/) spawn the scripts and assert exit code 0 ([T3]).
- **Silent-failure probes.** 30 new probe tests across [`extension/tests/integration/v2-flow.test.ts`](extension/tests/integration/v2-flow.test.ts), [`appsscript/tests/handlers/_coverage-gaps.test.ts`](appsscript/tests/handlers/_coverage-gaps.test.ts), [`extension/tests/lib/_silent-failure-probes.test.ts`](extension/tests/lib/_silent-failure-probes.test.ts) — surfaced 4 real bugs (see Fixed) and document acceptable silent behavior elsewhere ([T1]).

### Fixed (silent failures surfaced by the audit/test pass)

- **Manifest version drift.** [`extension/public/manifest.json`](extension/public/manifest.json) was at `0.2.0` while the v0.2.1 entry shipped — bumped to `0.2.1` (then `0.2.2` for this release). Smoke harness now blocks any CHANGELOG/manifest mismatch.
- **`critique` + `auto_revise` collapse `rate_limit` to `server`.** Both handlers used `err.errorType === 'auth' ? 'auth' : err.errorType === 'validation' ? 'validation' : 'server'` which clobbered `rate_limit` (and any other type). Clients couldn't tell rate-limited from server errors and couldn't back-off correctly. Now both forward `err.errorType` verbatim ([critique.ts:281](appsscript/src/handlers/critique.ts#L281), [autoRevise.ts:382](appsscript/src/handlers/autoRevise.ts#L382)). Caught by T2's `errors.contract.test.ts`.
- **Research + benchmark cache key collision.** Keys were `research:${company}:${role}` — a `:` in either field collided across pairs. `(company="Acme:foo", role="bar")` mapped to the same key as `(company="Acme", role="foo:bar")`, returning stale data for a different company. Keys are now `research:${JSON.stringify([company, role])}` (collision-free). Caught by T1's `_coverage-gaps.test.ts` C8 probe.
- **`onGenerate` rejections vanish.** A throw from the `onGenerate` hook propagated as an unhandled rejection — busy state never cleared and no error banner appeared. Now wrapped in `try/catch`: error message lands in the status banner; busy state is reset. Caught by T1's V6 probe.
- **Button never re-enables after pre-flight research/benchmark in test envs.** The pre-flight `setBusy(true, 'Researching…')` was never followed by `setBusy(false)` before delegating to `hooks.onGenerate`. In production this is hidden because the hook re-sets busy immediately; in fire-and-forget hooks (and during click sequences) the button stayed disabled. Now `setBusy(false)` is called right before the `onGenerate` invocation. Caught by T1's V8 probe.
- **Restored unknown model strings silently broke the DOM + cost preview.** If `chrome.storage.local.v2Toggles` had a model id no longer in `ALL_MODELS` (e.g. after a rename), the `<select>` value silently dropped to empty and the cost preview fell back to Haiku pricing without warning. Restore code now validates each model against `ALL_MODELS` and falls back to Haiku with a `console.warn`. Caught by T1's V10 probe.

### Internal

- 650 tests passing (up from 446 at v0.2.1; +204 across D1-D5 + T1-T4). All TS clean across both packages.
- Bundle sizes: extension/public/sidepanel/index.js 783.6 KB, background 12.2 KB, scraper 149.5 KB, style.css 26.7 KB, Apps Script `Code.gs` 97.1 KB — all well under verify-bundle thresholds.
- 9 parallel opus-4.7 agents (D1-D5 + T1-T4) launched in two batches; T1 and T4 reached the account usage cap during final reporting but had already written all owned files to disk; manual reconciliation + integration covered the remainder.

## [0.2.1] - 2026-05-11

Stabilization pass: rule-14 correctness fixes, per-bullet auto-revise UI, automatic v2 sheet column population, cover-letter tone selector, prompt-file consistency cleanup.

### Fixed

- **Rule-14 byte-identity now actually holds.** Three correctness bugs in the auto-revise handler were closing as `ok:true` while silently violating revision discipline:
  - Whitespace-only `instruction` strings (e.g. `"   \n"`) were accepted as valid revisions; now rejected with a validation error. ([`appsscript/src/handlers/autoRevise.ts:55-58`](appsscript/src/handlers/autoRevise.ts#L55-L58))
  - Trailing newline differences were silently stripped by `stripFences().trim()`, so out-of-scope trailing-whitespace changes never appeared in `unauthorizedChanges`. ([`appsscript/src/handlers/autoRevise.ts:167-174`](appsscript/src/handlers/autoRevise.ts#L167-L174))
  - CRLF input (`\r\n`) against LF output from Claude produced phantom `\r` deltas on every line; 18 spurious `unauthorizedChanges` on a 20-line resume. Both inputs are now LF-normalized before diffing. ([`appsscript/src/handlers/autoRevise.ts:180-193`](appsscript/src/handlers/autoRevise.ts#L180-L193))
  - Bonus: `computeDiff`'s out-of-bounds fallback to `''` made line-count changes invisible on one side; both sides now track presence flags so trailing/leading additions register.
- **Em-dash contradiction between prompt rules.** Rule 13 mandated `*— City, ST*` (em-dash) in every Experience role header while rule 05 capped em-dashes at 2 per document — every multi-role resume failed rule 11's self-scan. Rule 13's template now uses an ASCII hyphen (`*- City, ST*`); rule 05's cap stays intact. ([`prompts/shared/13-output-shape.md`](prompts/shared/13-output-shape.md))
- **Validator drift.** [`prompts/shared/_validate.test.ts`](prompts/shared/_validate.test.ts) asserted 12 rule files / 4 load-bearing / <10K tokens; actual was 15 / 6 / ~12K. Counts realigned to current state. (Side-find: this file is not yet in the root vitest include glob, so the validator runs only when targeted explicitly — flagged for a follow-up CI config fix.)
- **`scrollIntoView` guards.** Two side-panel call sites now check `typeof === 'function'` before calling, so unit tests under jsdom don't blow up on missing browser APIs. ([`extension/src/sidepanel/tabs/generate.ts:733-737, :1001-1003`](extension/src/sidepanel/tabs/generate.ts#L733))

### Added

- **Per-bullet / per-section / per-role auto-revise UI.** The resume editor gained `Edit` / `Preview` tabs. Preview mode renders each section / role / bullet with `data-section-name` / `data-role-company` / `data-bullet-id` attrs and an inline revise button per element. Clicking dispatches a `resume:revise` `CustomEvent` that the Generate tab listens for; the handler prompts for an instruction, calls `auto_revise` with the targeted scope, and renders the diff for Accept / Reject. Bullet IDs are CRC32-stable across re-renders. ([`extension/src/sidepanel/components/resumeEditor.ts`](extension/src/sidepanel/components/resumeEditor.ts), [`extension/src/sidepanel/tabs/generate.ts:728-737, :893-927`](extension/src/sidepanel/tabs/generate.ts#L728-L737))
- **Cover-letter tone selector.** Side panel now exposes `neutral` / `formal` / `casual` / `technical` / `persuasive` as a dropdown on the Cover Letter toggle row. Defaults to `neutral` (no tone directive, byte-identical to v0.2.0 output). Selected tone persists in `v2Toggles` storage and is forwarded as `tone` on `CoverLetterRequest`. ([`extension/src/sidepanel/components/toggleRow.ts`](extension/src/sidepanel/components/toggleRow.ts), [`extension/src/sidepanel/tabs/generate.ts`](extension/src/sidepanel/tabs/generate.ts))
- **Automatic tracking-sheet v2 column population.** `critique`, `cover_letter`, and `verify_cl_hooks` handlers each call `drive.updateSheetRow` (added in v0.2.0) to fill their respective columns (`Critique Score`, `Cover Letter URL`, `Verify Unverified Count`). All three accept optional `sheetId?` + `rowUrl?` request fields; omit either → no sheet write (graceful degradation). `multi_version` is left blank by design: the row label gets written from a future "finalize variant" flow once the user selects a variant. ([`appsscript/src/handlers/critique.ts`](appsscript/src/handlers/critique.ts), [`coverLetter.ts`](appsscript/src/handlers/coverLetter.ts), [`verifyHooks.ts`](appsscript/src/handlers/verifyHooks.ts))
- **Live cost preview includes v2 toggles.** `renderCostBlock()` now passes the full v2 toggle state to `estimateCost` and re-renders on every toggle / model / count change. The `Benchmark` row was missing from the cost estimator panel; now present. ([`extension/src/sidepanel/components/costEstimator.ts`](extension/src/sidepanel/components/costEstimator.ts), [`extension/src/sidepanel/tabs/generate.ts:378-398`](extension/src/sidepanel/tabs/generate.ts#L378-L398))
- **Rule files audit doc.** [`docs/superpowers/reviews/rule-files-audit.md`](docs/superpowers/reviews/rule-files-audit.md) — 3,345-word audit of all 14 prompt-rule files with file-by-file summary, cross-file contradictions, gaps, and prioritized recommendations.

### Changed

- The "Revise whole resume" button now lives inside the resume editor's Preview tab alongside the per-element buttons (was a separate button rendered into `[data-revise-diff]`). Same `resume:revise` event path; cleaner UX.
- Cover-letter request and matching handler now treat omitted `tone` as `neutral`; passing `tone: 'neutral'` is also accepted and produces no tone directive in the system prompt.

### Internal

- 446 tests passing (up from 436 at v0.2.0 snapshot). Test deltas: +14 auto-revise edge cases (rule-14 adversarial), +10 v2 sheet-update handler tests, +1 tone-aware generate.test.ts assertion, +5 cover-letter tone tests, EC-4 / EC-5 / EC-13 flipped from "documents current bug" to "asserts correct behavior".
- `tsc --noEmit` clean on both packages; both bundles build (extension 755.7 KB, Apps Script Code.gs 93.3 KB).
- Commit [`662a1c5`](https://github.com/) snapshot covers the v0.2.0 release; v0.2.1 fixes land on top of it.

## [0.2.0] - 2026-05-10

Seven optional pipeline features that augment the base `generate` flow. Each is toggleable from the side panel and uses its own Anthropic model selection. The side panel calls the Apps Script backend directly for v2 actions (bypassing the background worker).

See [docs/v2-features.md](docs/v2-features.md) for per-feature details, API shapes, and caveats.

### Added

- **Research company** (`research_company`) — web-search-backed company facts injected into the generate prompt as `=== Company Research ===`. Cached 24h per `<company>:<role>`.
- **LinkedIn role benchmark** (`benchmark_role`) — public-profile-style "what successful candidates look like" patterns injected as `=== Role Benchmark ===`. Cached 24h per `<company>:<role>`.
- **Critique pass** (`critique`) — second Claude call after generate; 8-dimension rubric + tiered improvements. Writes `critique.md` to the job folder when `jobFolderId` is supplied.
- **Auto-revise** (`auto_revise`) — surgical revision with scope discipline. Handler supports `bullet` / `section` / `role` / `whole-resume` scopes; UI today only wires whole-resume. Post-check byte-compares everything outside scope and surfaces `unauthorizedChanges`.
- **Cover letter** (`cover_letter`) — 3-paragraph HOOK / EVIDENCE / CLOSING letter (250-300 words) per [`prompts/shared/10-cover-letter-industry.md`](prompts/shared/10-cover-letter-industry.md). Writes `cover_letter.md` + Google Doc to the job folder.
- **Verify CL hooks** (`verify_cl_hooks`) — two-step entity extraction + web-search verification on the cover letter. Returns per-entity `verified` / `unverified` / `uncertain` plus sources.
- **Multi-version generation** (`multi_version`) — fan-out of N variants (2-5) with distinct framing directives (`Technical depth`, `Leadership`, `Business outcomes`, ...). Sequential under Apps Script V8 (no `Promise.all`).
- Load-bearing prompt rule [`prompts/shared/14-revision-discipline.md`](prompts/shared/14-revision-discipline.md) — enforces byte-identical content outside the revision scope.

### Changed

- Extracted user-message composition into [`appsscript/src/message-builder.ts`](appsscript/src/message-builder.ts) so `Code.ts` (generate) and `handlers/multiVersion.ts` (fan-out) share the same prompt shape.
- [`toggleRow`](extension/src/sidepanel/components/toggleRow.ts) now stamps `data-feature="<key>"` on each row for stable test/DOM hooks.
- [`claude.ts`](appsscript/src/claude.ts) forwards an optional `tools` array (e.g. `web_search_20250305`) from `ClaudeRequest` through to the Anthropic Messages API.
- New `ClaudeTool` type in [`appsscript/src/types/claude-api.ts`](appsscript/src/types/claude-api.ts).
- New Drive helpers `createFileInFolder` and `createGoogleDoc` in [`appsscript/src/drive.ts`](appsscript/src/drive.ts), used by the cover-letter and critique handlers.
- `GenerateRequest` gained optional `researchSummary` and `benchmarkPatterns` fields ([`appsscript/src/types/api-contract.ts`](appsscript/src/types/api-contract.ts)) so the side panel can pre-fetch context and pass it through to the generate call.
- File layout: per-feature handlers under [`appsscript/src/handlers/`](appsscript/src/handlers/), per-feature side-panel modules under [`extension/src/sidepanel/features/`](extension/src/sidepanel/features/).

### Internal

- 356 tests passing (up from 210 baseline). New test files cover each handler, each side-panel feature module, and the shared message-builder.
- `tsc --noEmit` clean on both packages; both bundles build.

## [0.1.0] - 2026-04

Initial release. Single-action `generate` flow: scrape JD from the page (LinkedIn, Indeed, Greenhouse, Lever, Workday, Ashby, plus generic HTML), build a tailored resume via Anthropic with prompt caching, write the result as a Google Doc into a per-job Drive folder, log a row to a tracking sheet. `finalize` action exports the user-edited markdown to DOCX or PDF via Google Docs' native exporter. Client-side `templateFiller` fills a user-supplied DOCX template with the generated markdown (`download_template` + `upload_filled_docx` actions). Settings panel handles configuration, key storage, and rule-file seeding from [`prompts/shared/`](prompts/shared/).
