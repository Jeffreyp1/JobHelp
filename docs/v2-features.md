# JobHelp v2 features

Seven optional augmentations to the base `generate` flow. Each is a separate Apps Script action with its own request/response shape in [`appsscript/src/types/api-contract.ts`](../appsscript/src/types/api-contract.ts). Each is wired to a side-panel toggle in [`extension/src/sidepanel/tabs/generate.ts`](../extension/src/sidepanel/tabs/generate.ts); per-feature UI lives under [`extension/src/sidepanel/features/`](../extension/src/sidepanel/features/); handlers live under [`appsscript/src/handlers/`](../appsscript/src/handlers/).

## Architecture notes

- v2 actions are called **directly from the side panel** via [`apiClient`](../extension/src/lib/apiClient.ts) — they do not pass through the background service worker. The background worker still owns `generate` / `finalize` / `list_files` / `seed_defaults` / `write_file` / `download_template` / `upload_filled_docx`.
- Research and benchmark run **before** the main generate call; their text output is passed through `GenerateRequest.researchSummary` / `GenerateRequest.benchmarkPatterns` and rendered into the user message under `=== Company Research ===` / `=== Role Benchmark ===` (see [`appsscript/src/message-builder.ts`](../appsscript/src/message-builder.ts)).
- Critique, cover-letter, auto-revise, and verify-CL-hooks run **after** generate; multi-version is **mutually exclusive** with the standard generate flow.
- All handlers return `ApiResult<T>` and never throw across the HTTP boundary.

## Feature summary

| Feature | Action | Order | Web search | Cached | Output written to Drive |
|---|---|---|---|---|---|
| Research company | `research_company` | Pre-generate | Yes | 24h | No |
| LinkedIn role benchmark | `benchmark_role` | Pre-generate | Yes | 24h | No |
| Critique pass | `critique` | Post-generate | No | No | `critique.md` (if `jobFolderId`) |
| Auto-revise | `auto_revise` | Post-generate | No | No | No (returns markdown only) |
| Cover letter | `cover_letter` | Post-generate | No | No | `cover_letter.md` + Google Doc |
| Verify CL hooks | `verify_cl_hooks` | Post-cover-letter | Yes | No | No |
| Multi-version | `multi_version` | Replaces generate | No | No | No (UI picks a variant to save) |

Cost columns are intentionally omitted — see "Cost notes" below.

---

## Research company

**What it does.** Calls Claude with the `web_search_20250305` tool to produce a short summary of recent, role-relevant facts about the target company (recent funding/launches, public tech stack, notable team members). The summary is injected into the main generate prompt as `=== Company Research ===`.

**When to enable.** When you have a specific company name and want the resume framing to reflect public information about that company (e.g. emphasising payments experience for a fintech, or distributed-systems experience for an infrastructure shop).

**API.** [`ResearchCompanyRequest` / `ResearchCompanyResponse`](../appsscript/src/types/api-contract.ts) — input `{company, role, model, forceRefresh?}`, output `{summary, keywords[], sources[], cached, cost}`.

**Caveats.**

- Requires a non-empty `company`. Skipped silently in the UI when `state.company` is null.
- Cache key is `research:<company>:<role>` with a 24-hour TTL via Apps Script `CacheService`. Pass `forceRefresh: true` to bypass.
- Web-search results depend on Anthropic's tool implementation; the handler returns `sources[]` so the UI can show citations.

## LinkedIn role benchmark

**What it does.** Web-search-backed paragraph describing what successful candidates for the given `{company, role}` typically look like — extracted from public profile-style snippets. Injected into the main generate prompt as `=== Role Benchmark ===`.

**When to enable.** When you want the generator to lean toward keywords and framing that match the public archetype for the role.

**API.** [`BenchmarkRoleRequest` / `BenchmarkRoleResponse`](../appsscript/src/types/api-contract.ts) — input `{company, role, model, forceRefresh?}`, output `{patterns, keywords[], sources[], cached, cost}`.

**Caveats.**

- Requires **both** a non-empty `company` and `role`. Skipped in the UI when either is missing.
- Same `CacheService` 24-hour TTL as research, keyed `benchmark:<company>:<role>`.
- Output quality depends entirely on what the search surfaces; for niche roles the patterns may be sparse.

## Critique pass

**What it does.** Second Claude call after generation. Scores the generated resume on 8 weighted dimensions (`keyword_coverage`, `bullet_impact`, `structure`, `formatting`, `relevance`, `truthfulness`, `conciseness`, `ats_friendliness`) and returns a tiered list of improvements. When a `jobFolderId` is passed, writes `critique.md` into the job folder.

**When to enable.** When you want a sanity check on the generated resume before sending it.

**API.** [`CritiqueRequest` / `CritiqueResponse`](../appsscript/src/types/api-contract.ts) — input `{resumeMd, jd, jobInsights, jobFolderId, model, sheetId?, rowUrl?}`, output `{scores[], totalScore, improvements[], critiqueDocUrl, cost}`.

**Sheet integration (since v0.2.1).** Pass optional `sheetId` + `rowUrl` and the handler writes `totalScore` into the tracking sheet's `Critique Score` column. Sheet-write failure is non-fatal.

**Caveats.**

- Drive write is non-fatal: a Drive failure degrades to `ok:true` with `critiqueDocUrl: null` rather than failing the call.
- The 8-dimension weights are fixed in [`appsscript/src/handlers/critique.ts`](../appsscript/src/handlers/critique.ts); to change them, edit `DIMENSION_WEIGHTS`.

## Auto-revise

**What it does.** Surgical-precision revision. Caller supplies `{currentMarkdown, targetScope, instruction}`. Claude returns the full revised markdown; the handler then byte-compares every line outside the scope and reports any drift in `unauthorizedChanges` so the UI can warn before accepting. Driven by [`prompts/shared/14-revision-discipline.md`](../prompts/shared/14-revision-discipline.md), which is injected verbatim into the system prompt.

**Scope shapes:**

| `targetScope.kind` | Modifies | Reachable in UI |
|---|---|---|
| `bullet` (`bulletId`) | One bullet line | Yes (since v0.2.1) |
| `section` (`sectionName`) | One section | Yes (since v0.2.1) |
| `role` (`companyName`) | One role entry | Yes (since v0.2.1) |
| `whole-resume` | Entire resume | Yes |

**When to enable.** When you want a one-shot, scope-bounded revision of the generated resume after reviewing it.

**API.** [`AutoReviseRequest` / `AutoReviseResponse`](../appsscript/src/types/api-contract.ts) — input `{currentMarkdown, targetScope, instruction, model}`, output `{revisedMarkdown, diff[], unauthorizedChanges[], cost}`.

**UI flow (since v0.2.1).** The resume editor exposes `Edit` / `Preview` tabs. In Preview mode each section / role / bullet renders with a small revise button. Clicking it dispatches a `resume:revise` `CustomEvent` carrying the scope + current markdown; the Generate tab prompts for an instruction, calls `auto_revise`, and renders the diff with Accept / Reject. Bullet IDs are CRC32-stable, so the same markdown re-renders with the same IDs across reloads.

**Rule-14 correctness (v0.2.1).** Three byte-identity bugs were fixed: whitespace-only instructions are now rejected as validation errors; trailing-newline differences are no longer silently stripped by the fence-stripper; CRLF input is LF-normalized before diffing so a CRLF-vs-LF mismatch no longer produces spurious `unauthorizedChanges` on every line.

**Caveats.**

- `unauthorizedChanges` is informational only — the handler does not reject the response. The UI should display the warning and let the user accept or reject.
- `findRoleRange` / `findSectionRange` are first-match-only: if a resume contains two `### Engineer at Acme` headings, only the first is treated as in-scope.

## Cover letter

**What it does.** Generates a 3-paragraph industry cover letter (HOOK / EVIDENCE / CLOSING, 250-300 words) per [`prompts/shared/10-cover-letter-industry.md`](../prompts/shared/10-cover-letter-industry.md). Writes `cover_letter.md` and a Google Doc into the supplied `jobFolderId`.

**When to enable.** When the posting requires (or strongly prefers) a cover letter.

**API.** [`CoverLetterRequest` / `CoverLetterResponse`](../appsscript/src/types/api-contract.ts) — input `{resumeMd, jd, company, role, sourceFolderId, rulesFolderId, jobFolderId, model, tone?}`, output `{coverLetterMd, docUrl, mdFileUrl, cost}`.

**Tone selector (since v0.2.1).** Optional `tone` field accepts `neutral` (default — backwards-compatible with v0.2.0 output) / `formal` / `casual` / `technical` / `persuasive`. Definitions live in [`prompts/shared/15-cl-tones.md`](../prompts/shared/15-cl-tones.md); when a non-neutral tone is requested the handler appends a `=== TONE: <tone> ===` block to the system prompt. Surfaced as a dropdown alongside the Cover Letter toggle row in the side panel.

**Sheet integration (since v0.2.1).** Pass optional `sheetId` + `rowUrl` and the handler will write `coverLetterUrl` into the tracking sheet's `Cover Letter URL` column. Failure to write is non-fatal — the response still returns `ok: true`.

**Caveats.**

- Requires a `jobFolderId`. The handler always writes to Drive (it is not run as a preview-only step).
- Reads source materials and rule files on every call — no caching of the prompt context. Prompt caching is applied at the Anthropic layer via the system blocks.

## Verify CL hooks

**What it does.** Two-step process on a cover letter:

1. Extraction call (no tools) to list named entities (PI names, products, programs, papers, companies).
2. Per-entity verification call **with** the `web_search_20250305` tool to confirm existence.

Returns per-entity status `verified` / `unverified` / `uncertain`, plus the sources used. Cost is accumulated across all calls.

**When to enable.** Whenever a cover letter has been generated and you want to catch hallucinated names or programs before sending.

**API.** [`VerifyClHooksRequest` / `VerifyClHooksResponse`](../appsscript/src/types/api-contract.ts) — input `{coverLetterMd, model, sheetId?, rowUrl?}`, output `{verifications[], unverifiedCount, cost}`.

**Sheet integration (since v0.2.1).** Pass optional `sheetId` + `rowUrl` and the handler writes `unverifiedCount` into the tracking sheet's `Verify Unverified Count` column. Sheet-write failure is non-fatal.

**Caveats.**

- One web-search call per extracted entity — cost scales linearly with the number of named entities in the letter.
- A single entity search failure marks that entity `uncertain` rather than failing the whole call.
- Triggered from the cover-letter result card in the UI; not a standalone toggle.

## Multi-version

**What it does.** Generates N (2-5) full resume variants in parallel, each with a different framing directive appended to the base system prompt. Defaults: `Technical depth`, `Leadership`, `Business outcomes`, `Startup generalist`, `Cross-functional impact`. Source and rule files are read once and shared across all calls.

**When to enable.** When you have time to compare framings before committing.

**API.** [`MultiVersionRequest` / `MultiVersionResponse`](../appsscript/src/types/api-contract.ts) — input `{jd, company, role, jobInsights, sourceFolderId, rulesFolderId, model, count, framings?}`, output `{variants[], cost}`.

**Caveats.**

- **Mutually exclusive with the standard generate flow** — enabling multi-version replaces the normal `Generate` button behaviour, and post-generate features (critique, cover-letter, auto-revise) are not chained.
- Apps Script V8 does not support `Promise.all`; variant calls run sequentially in the handler. Wall-clock time scales linearly with `count`.
- The UI picks a variant; saving to Drive (job folder, sheet row) is handled separately by the existing generate-flow finalize step.

## Cost notes

Per-call costs are not documented here because the underlying token usage depends on:

- the size of the user's source materials and rule files,
- the JD length,
- the chosen Anthropic model (Haiku / Sonnet / Opus),
- prompt-cache warm vs. cold,
- web-search query count (research, benchmark, verify-CL-hooks).

Every response carries a [`CostBreakdown`](../appsscript/src/types/api-contract.ts) with the actual input/output/cache token counts and computed USD total — that is the authoritative number. The cost estimator in the side panel uses heuristic per-feature deltas; see [`extension/src/lib/costCalculator.ts`](../extension/src/lib/costCalculator.ts).
