# Changelog

All notable changes to JobHelp are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
