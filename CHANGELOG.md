# Changelog

All notable changes to JobHelp are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Auto-apply phase 2 — hybrid CLI pre-fill:** a browser daemon
  (`autoapply/engine/src/browser-daemon.ts`) owns one Chromium over CDP; the
  deterministic engine pre-fills profile-sourced fields and uploads the resume
  in under a second per job (`--prefill --cdp`, measured 0.7-0.9s on fixtures
  vs minutes AI-only), writes `autoapply-leftovers.json`, and exits — tabs
  survive in the daemon for the AI session, whose Playwright MCP now attaches
  via `--cdp-endpoint`. The AI fills only essays and odd widgets, then
  double-checks the whole form. Engine consults `autoapply/overrides.json`
  labelRules before its built-in label classifier, enabling the self-update
  loop to repair field mappings without code changes. New CLI args:
  `--prefill`, `--cdp`, `--url/--dir/--resume` (ad-hoc), `--ats` (force
  adapter). 16 new engine tests; never submits in prefill mode.
- **Auto-apply self-update loop:** every field the filler can't complete is now
  logged to `~/jobhelp/autoapply-gaps.jsonl` (verbatim question, options, and a
  routing reason). A new `/auto-apply-update` skill consumes that log: it
  clusters gaps deterministically (`autoapply/engine/src/cluster-gaps.ts`,
  test-covered), applies safe data fixes directly, applies code/playbook fixes
  only behind test gates, and documents every run in `autoapply/updates/`. Its
  write access is hard-bounded to the new `autoapply/` folder (engine, learnable
  playbook, overrides, fixtures) — safety rules, the standing profile, and the
  answer bank live outside it and stay human-only.
- **Auto-apply skill (v1):** a `/auto-apply` Claude Code skill that fills job
  application forms in a headful browser via the Playwright MCP — ATS-agnostic,
  no per-site adapters. Answers come from the standing profile, the job's
  tailored resume, and a growing answer bank (`~/jobhelp/answer-bank.json`);
  every drafted answer carries provenance in `<job dir>/autoapply-review.json`. The
  skill never submits: every application parks in an open tab for human review.
  Spec: docs/superpowers/specs/2026-06-09-autoapply-v1-playwright-skill-design.md.

### Changed

- **Auto-revise rewrite (scoped):** Replaced the broken bullet/section revise flow. The model now only sees the in-scope excerpt (one bullet or one section's bullets), so byte equality of out-of-scope text is guaranteed by construction rather than by post-hoc validation. A new `auto_revise_scoped` action runs a two-agent creator+checker prompt with one retry on checker failure; checker findings surface as warning chips in the UI. The browser-native `prompt()` dialog is replaced with an inline composer that opens beneath the targeted bullet or section heading. Edit/Preview tabs in the resume editor were merged into a single click-to-edit view; a collapsed `<details>` exposes raw markdown for power edits. `whole-resume` revise keeps the existing full-document handler.

## [0.3.0] - 2026-05-12

Job pipeline — Phase 1 of the auto-apply architecture (see [docs/research/auto-apply-architecture.md](docs/research/auto-apply-architecture.md)): discover relevant postings, rank them against your resume, track them in a sheet, one-click "tailor resume" reusing the existing engine. No auto-submit — per the research that's the part with no API / ToS violations / LinkedIn perma-bans; the flow is discover → tailor → you click apply & submit.

### Added — backend (Apps Script)

- **`extract_profile` action** ([handlers/extractProfile.ts](appsscript/src/handlers/extractProfile.ts)) — reads your source materials and distils them into a `JobProfile` (candidate titles, seniority, a canonical skill list, domains, search queries, filters, and a ~200-word summary) via one Claude call. Robust JSON parse with per-field type checks and sane backfilling. ([lib/jobProfile.ts](appsscript/src/lib/jobProfile.ts))
- **`discover_and_rank` action** ([handlers/discoverAndRank.ts](appsscript/src/handlers/discoverAndRank.ts)) — polls the configured job sources, dedups, ranks against the profile, upserts the top N into the Job Pipeline sheet, returns the ranked list. Discovery sources ([lib/jobDiscovery.ts](appsscript/src/lib/jobDiscovery.ts)): Adzuna API (free dev tier), Greenhouse public job boards (`boards-api.greenhouse.io/v1/boards/{token}/jobs`), Lever public boards (`api.lever.co/v0/postings/{client}?mode=json`), JSearch on RapidAPI (optional paid wide-net), USAJOBS (no-op stub until an API key is wired). Each source is fault-isolated — one source failing logs a warning and the rest still run. Ranking ([lib/jobRanking.ts](appsscript/src/lib/jobRanking.ts)): Stage A = weighted keyword overlap between the JD and `profile.skills` (with a `topN` floor so a sparse day still returns something); recency boost `max(0.5, 1 - daysOld/30)` plus an optional hard "posted within N days" filter; Stage B (optional) = a batched Claude fit-score on the top survivors (5 jobs per call, falls back to the keyword score on a parse failure); `finalScore = (fitScore ?? keywordScore) × recencyBoost`.
- **`update_job_status` action** ([handlers/updateJobStatus.ts](appsscript/src/handlers/updateJobStatus.ts)) — sets a Job Pipeline row's status (`new` → `tailored` → `applied` / `rejected` / `closed`) and optionally its tailored-resume Drive link.
- **Job Pipeline sheet ops** ([drive.ts](appsscript/src/drive.ts)) — `ensureJobPipelineSheet` (creates a "Job Pipeline" tab with a 14-column header), `upsertJobPipelineRows` (keyed by `jobId` — re-discovering a job updates its data cells but never overwrites the Status or Notes you've set), `updateJobPipelineStatus`, `readJobPipelineRows`. Added as optional methods on the `DriveOps` interface so existing typed mocks keep compiling.
- **Daily digest cron** ([triggers.ts](appsscript/src/triggers.ts)) — `installDailyJobDigest()` registers a time-driven trigger; `runDailyJobDigest()` reads a `JOBHELP_DIGEST_CONFIG` Script Property (`{ profile, config, maxDaysOld, topN, fitScoreModel?, sheetId }`), runs `discover_and_rank`, logs the outcome. Never throws (a thrown error in a trigger emails the owner).
- New shared types ([types/job-discovery.ts](appsscript/src/types/job-discovery.ts), mirrored to the extension): `JobSource`, `JobPipelineStatus`, `DiscoveredJob`, `JobProfile`, `RankedJob`, `DiscoveryConfig`, `JobPipelineRow`. New request/response shapes in both `api-contract.ts` copies for the 3 actions.

### Added — extension (side panel)

- **"Jobs" tab** ([sidepanel/tabs/jobs.ts](extension/src/sidepanel/tabs/jobs.ts)) — the daily-digest UI. Header controls: Refresh digest, "posted within N days", "show top N", an "use AI fit-score" checkbox + model dropdown, and Re-extract profile. Ranked job list: one expandable row per job (company · title · location · "posted N days ago" · a `finalScore`% badge · the source name); expanding shows matched-skill chips, missing-skill chips, a ~400-char JD snippet, and an action bar — Open posting / Tailor resume / Mark applied / Dismiss. Footer summary line after each refresh ("X found, Y shown · cost $Z"). All hooks degrade gracefully when discovery sources or the runtime config aren't set ("…configure in Settings"), never throwing.
- `apiClient` gained `extractProfile`, `discoverAndRank`, `updateJobStatus` (mirroring the existing v2-method style); `sidepanel/index.ts` wires the Jobs-tab hooks (extract profile → cache it; run digest → assemble the request from the cached profile + `getRuntimeConfig()` + discovery keys read from `chrome.storage.local` → call the backend → render; tailor → prefill the Generate tab via its existing scraper-ingestion path; mark status → call `update_job_status`). The "Jobs" nav button is injected at runtime so `index.html` stays untouched.

### Internal

- 844 tests passing (up from 688 at v0.2.3; +156 across the scaffold + J1-J5: jobDiscovery 27, jobProfile 15, jobRanking 20, jobPipelineSheet 20, extractProfile/discoverAndRank/updateJobStatus/triggers 55, jobs-tab 19). tsc clean both packages. Bundles: Apps Script `Code.gs` ~148 KB, extension/public/sidepanel/index.js ~796 KB. verify-bundle 12/12.
- 5 parallel opus-4.7 agents (J1 discovery lib · J2 profile + ranking libs · J3 sheet ops · J4 handlers + cron + router wiring · J5 UI tab + apiClient) on a pre-scaffolded contract; CLAUDE.md's parallel-agent file-ownership rules held — agents flagged cross-impacts in sibling-owned files rather than editing them.

### Not done (Phase 1 follow-ups, all flagged in agent reports)

- `JobhelpConfig` doesn't carry a `discovery` block yet — the Jobs tab reads Adzuna keys / Greenhouse-Lever target lists from `chrome.storage.local` keys (`adzunaAppId`, `adzunaAppKey`, `jsearchRapidApiKey`, `greenhouseBoards`, `leverClients`, `usajobs`, `country`) directly; a Settings section to populate them and a `JobhelpConfig.discovery` field are the natural next step.
- USAJOBS is a no-op stub — wiring it needs optional `usajobsApiKey?` / `usajobsEmail?` on `DiscoveryConfig`.
- "Tailor resume" only prefills the Generate tab; it doesn't auto-switch tabs or auto-trigger generate (would need a public `triggerGenerate()` on the Generate controller or a new message-bus event).
- `triggers.ts` duplicates `Code.ts`'s private `resolveDeps()` rather than importing it (kept Code.ts changes minimal).
- The daily-digest config (`JOBHELP_DIGEST_CONFIG` Script Property) has no UI to populate it yet — it's set manually in the Apps Script editor for now.

## [0.2.3] - 2026-05-11

Wires the v2.1 single-file config into the runtime, adopts the structured logger across both packages, and clears the highest-priority silent-failure findings from the v0.2.2 audit.

### Changed (v2.1 config now live)

- **Side panel reads `getRuntimeConfig()` instead of legacy `chrome.storage` keys.** `generate.ts`, the Files tab data hook, and the `onFinalize` / `onConvertViaTemplate` hooks in `sidepanel/index.ts` now pull folder IDs / sheet ID / Apps Script URL / default model from the Drive-hosted `jobhelp-config.json` (loaded on side-panel open). When config isn't linked yet, they degrade gracefully ("Run setup in Settings first") instead of silently using empty IDs.
- **Legacy-key mirror bridge.** When the side panel resolves the Drive config, it fire-and-forget mirror-writes the resolved values back into the 8 deprecated `chrome.storage.local` keys. The background service worker (`background.ts`) still reads those keys for the `generate`/`finalize`/etc. actions — keeping them populated as a derived cache means the worker needs zero changes during the migration window. The Drive file remains the source of truth.
- **v2 handlers now receive `sheetId` + `rowUrl`.** `generate.ts` captures `sheetRowUrl` from the generate result (4th arg to `showGenerateResult`) and threads `{ sheetId, rowUrl }` into the `critique` / `cover_letter` / `verify_cl_hooks` calls — so the Critique Score / Cover Letter URL / Verify Unverified Count sheet columns now actually get written. Omitted cleanly when either value is missing (matches the backend's "write only if both present" contract).

### Changed (observability)

- **`structuredLog` adopted across both packages.** ~55 raw `console.*` calls in the Apps Script handlers + `Code.ts` + `drive.ts` + `claude.ts` + `cost.ts` replaced with leveled `log(level, msg, ctx)` calls passing structured context objects (`{ company, role, cached, cost, error, ... }`) — automatic API-key redaction + 2 KB truncation now applies everywhere. Same on the extension side at every silent-failure site in `apiClient.ts`, `background.ts`, `templateFiller.ts`, `configLoader.ts`, `costCalculator.ts`. `doPost` logs every request (`info`) and every error path (`warn`/`error`).

### Fixed (HIGH-priority silent failures from `docs/superpowers/reviews/silent-failure-audit.md`)

- **`generate` accepted requests with no company AND no role.** Now rejected with a validation error before any Claude call (H11).
- **Malformed `jobInsights` payloads silently degraded.** `handleGenerate` now guards with a plausibility check and rejects obviously-malformed insights instead of passing junk to the prompt (H19).
- **`writeJobOutput` / `createGoogleDoc` left the Doc at My Drive root if `removeFile`/`addFile` were unavailable** — no signal. Now logs a `warn` (H14).
- **`updateSheetRow` / `appendSheetRow` no-op'd silently on bad row indices.** Now each early-return logs a `warn` (H15, H16).
- **`seedDefaults` per-file failures vanished.** Each failure + a summary now logs (H17).
- **`classifyError` misclassified Drive vs other errors via a fragile substring match** — silently. Now logs the raw error on every branch so misclassifications are diagnosable (H8, partial — full fix needs a typed exception hierarchy).
- **`apiClient.post` rejected with an opaque error on a 200-with-HTML body.** Now reads `.text()` → `JSON.parse` → shape-checks the `ok` flag → returns a typed `ok:false` server error with a body snippet (H5, M10).
- **`background.ts safeSend` swallowed all send failures the same way.** Now distinguishes "no receiver" (benign, silent) from real send errors (logged `warn`); `tabs.get` similarly distinguishes "no such tab" from other errors (H1, H3).
- **`templateFiller` silently dropped skills/experience lines it couldn't parse.** Now logs a `warn` listing the dropped lines (H6, H7).
- **`verifyHooks` non-JSON web-search responses** now log a `warn` with a body snippet and keep the entity at `uncertain` with the raw text in `reason` (H4, M6).
- **`costCalculator` / `cost.ts` silently used Haiku pricing for unknown model IDs.** Now logs a once-per-session `warn` ("reported cost may be wrong") before falling back (M16).
- **`coverLetter` accepted non-string `company`/`role`.** Now type-checked in the validator (H21).

### Fixed (contract cleanup)

- JSDoc on `MultiVersionRequest.count` documents the valid `[2, 5]` range (the type stays `number` — a literal union would force every caller to widen); `MultiVersionRequest.sheetId`/`rowUrl` documented as currently-ignored (the Multi-Version Label column is written by the not-yet-built finalize-variant flow); `HookVerification.sources` documented as always-present-possibly-empty. Mirrored byte-identically in both `api-contract.ts` copies (T2 ambiguities).
- `prompts/**/*.test.ts` added to the vitest `include` glob — `prompts/shared/_validate.test.ts` (the rule-file validator) now runs in CI (+10 tests). C3 had already aligned its assertions; no re-alignment needed.
- Rule 13's prose said "em-dash between school and degree" while its template uses an en-dash — prose corrected to "en-dash" with a "matching the template above" note.

### Internal

- 688 tests passing (up from 650 at v0.2.2; +38: 7 config-plumbing, 5 generate-validation, 3 cover-letter-validation, 3 apiClient non-JSON, 4 background-logging, 3 templateFiller-logging, 3 configLoader, 10 rule-file validator, 2 `_silent-failure-probes` flipped to "asserts fixed", plus the new probe V11). tsc clean both packages. Bundles: extension/public/sidepanel/index.js ~800 KB, Apps Script `Code.gs` 107.7 KB.
- 4 parallel opus-4.7 agents (E1 config wiring · E2 Apps Script observability+fixes · E3 extension observability+fixes · E4 contract cleanup). The deferred multi-version finalize-variant flow remains unimplemented; ~20-30 MEDIUM/LOW audit findings (mostly blocked on `types/*` additions) remain — see the audit doc.

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
