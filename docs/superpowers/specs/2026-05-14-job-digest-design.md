# JobHelp `/job-digest` — Design Specification

**Date:** 2026-05-14
**Status:** Revision 2 (Design B pivot)
**Owner:** Jeffrey

> **Revision 2 (2026-05-14 evening):** pivoted to **Design B (zero-API-key, MCP-first)**. The MCP server is now the primary deliverable. It exposes pure data tools (HTTP fetch, regex parsing, file IO) and prompt-context resources (rule files, resume dump). The client AI — Claude Code, Claude Desktop on Max, Cursor on Cursor Pro, Codex, any MCP-compatible client — does all reasoning (ranking, tailoring, critique) using its own subscription. **Zero `ANTHROPIC_API_KEY` required; no `@anthropic-ai/sdk` dependency.** Phase 1 code (already merged in `job-digest/integration`) shipped with Design-A artifacts (`core/lib/claude.ts`, `rank.ts` LLM fit-score path); these become optional/unused once the MCP server lands and are slated for removal from the public surface in Phase 2.

---

## 1. Purpose & scope

A proactive job-discovery MCP server that complements (not replaces) the existing JobHelp extension.

| | Extension (existing) | `/job-digest` MCP (new) |
|---|---|---|
| Trigger | User opens a JD page in Chrome | User invokes a tool from any MCP client |
| Mode | Reactive (user already found it) | Proactive (we find them) |
| Output | One tailored resume for one JD via Apps Script | Ranked digest + tailored resumes via client AI |
| Surface | Chrome side panel | MCP server consumed by Claude Code / Desktop / Cursor / Codex / Zed / etc. |
| Who pays for LLM work | User's Anthropic API key (in Apps Script) | User's existing plan in their MCP client (Claude Max, Cursor Pro, etc.) — **zero API key** |

**Architectural principle (Design B, NON-NEGOTIABLE):** The MCP server does NOT make LLM calls. Ever. It exposes deterministic data + computation tools and exposes prompt-context resources. The intelligence (matching, ranking, tailoring, critique) is performed by the client's AI using its own LLM access. This decouples JobHelp from any specific model vendor and lets any MCP client install and use it for the cost of one npm install.

**Success criteria for v1:**

| Criterion | Measure |
|---|---|
| Coverage | At least 3 working source adapters; ≥50 raw postings/day before filtering |
| Quality | Top-10 digest contains ≥3 jobs the candidate would actually click (manual eval, judged by client AI) |
| Speed | Full digest tool-call returns in <30s (HTTP fetches dominate) |
| Cost | **$0** in API calls from the server; LLM cost is whatever the client's plan charges |
| Portability | One npm package, installable in any MCP client (Claude Code, Claude Desktop, Cursor, Zed, Codex, Continue, etc.) |
| Error resilience | No silent failures; structured logs for every source attempt |
| Distribution | `npx -y @jeffreyp1/jobhelp-mcp` — no API key, no signup, runs entirely on user's MCP client's existing subscription |

---

## 2. Architecture — MCP-first, zero-API-key

The package is **independent of the existing Apps Script backend.** That backend continues to handle the Chrome-extension resume-tailoring flow (and keeps using the user's Anthropic API key, since that flow is browser-bound). `/job-digest` runs entirely in Node and **does not call any LLM.**

**Tool taxonomy:**
- **Tools** (functions the client AI can call): pure data + IO. HTTP fetches, regex/string parsing, file writes, deterministic scoring. Zero LLM, zero AI dependency.
- **Resources** (context the client AI loads into its prompt): the 15 rule files from `prompts/shared/*.md`, the candidate's `resume-dump.md`, past digest CSVs, application history. These are static files served verbatim — the AI applies them.

**Who does what:**
- Server: fetches Adzuna/Greenhouse/Lever, normalizes shapes, deterministic-keyword-scores, writes files, loads rule files for the client.
- Client AI (in Claude Code / Desktop / Cursor / Codex / etc.): reasons over the data, applies the rule files, generates tailored resume markdown in its own context, critiques, revises, decides which tools to call next.

```
@jeffreyp1/jobhelp-mcp/           (npm package, MCP server)
├── core/                          ← deterministic logic (no LLM)
│   ├── sources/                   ← one file per adapter, fault-isolated
│   │   ├── adzuna.ts
│   │   ├── greenhouse.ts
│   │   ├── lever.ts
│   │   ├── usajobs.ts             (stub — flagged for future)
│   │   ├── jsearch.ts             (stub — paid, future)
│   │   ├── _shared.ts             (SourceFetchError + helpers, extracted Phase-1 fixer)
│   │   └── index.ts               (ALL_ADAPTERS registry)
│   ├── pipeline/
│   │   ├── normalize.ts           (validate + trim + cap description)
│   │   ├── filter.ts              (location / salary / seniority hard filters)
│   │   ├── dedupe.ts              (v0 exact-id; TODO_FUTURE for URL+hash)
│   │   └── rank.ts                (PURE deterministic: keyword × recency. NO LLM stage.)
│   ├── digest/
│   │   ├── generate.ts            (fetch → pipeline → format → write)
│   │   └── format.ts              (markdown + CSV emitters)
│   └── lib/
│       ├── log.ts                 (structured logger with secret redaction)
│       └── config.ts              (loads ~/.config/jobhelp/config.json)
│       (no claude.ts — removed in Design B)
│
├── mcp/                           ← MCP server (primary surface)
│   ├── src/index.ts               (stdio MCP bootstrap)
│   ├── src/tools.ts               (tool handlers wrapping core/)
│   └── src/resources.ts           (rule files + dump + history as resources)
│
├── tests/
└── package.json                   (NO @anthropic-ai/sdk dependency)
```

All business logic lives in `core/`. The `mcp/` directory is a thin protocol adapter. No `cli/` for v1 (deferred — see §11). No `skill/` for v1 (Claude Code can install the MCP server natively; a separate skill is redundant). No `tailor/` directory — tailoring is the client AI's job, executed in its own context using the rule-file resources we expose.

---

## 3. Data model — `NormalizedJob`

```typescript
interface NormalizedJob {
  id: string;             // source-prefixed: "adzuna:abc123"
  source: string;         // "adzuna" | "greenhouse" | "lever" | ...
  url: string;            // canonical apply URL
  title: string;
  company: string;
  location: string;       // "Irvine, CA" or "Remote (US)"
  remote: 'remote' | 'hybrid' | 'onsite' | 'unknown';
  salaryMin?: number;     // USD
  salaryMax?: number;     // USD
  salaryCurrency?: string;
  postedAt?: string;      // ISO timestamp
  description: string;    // full JD text (boilerplate-stripped if possible)
  rawSourceData?: unknown;// keep for debugging; not in output digest
}
```

Every adapter MUST emit this shape. Any field except `id`, `source`, `url`, `title`, `company`, `description` may be missing.

---

## 4. Source adapters — file-per-source contract

Each adapter exports a `SourceAdapter`:

```typescript
interface SourceAdapter {
  name: string;
  enabled: (config: JobDigestConfig) => boolean;       // true iff config has required auth
  fetch: (config: JobDigestConfig) => Promise<NormalizedJob[]>;
}
```

The orchestrator iterates over enabled adapters in parallel (`Promise.allSettled`). One adapter throwing logs a structured warning and the rest still run. **No silent failure.**

| Adapter | Auth | Cost | Coverage |
|---------|------|------|----------|
| `adzuna` | App ID + Key (free dev tier) | Free | US aggregator, ~50K+ postings |
| `greenhouse` | per-company `token` (public board) | Free | Per-company; lists DoorDash, OpenAI, Stripe, etc. |
| `lever` | per-company `slug` (public board) | Free | Per-company; lists Anthropic, Plaid, Mercury, etc. |
| `usajobs` | API key + email (free) | Free | Federal jobs only — stubbed for now |
| `jsearch` | RapidAPI key | **Paid** — flagged off by default | Wider net via RapidAPI |

All adapter implementations are self-contained one-file modules with their own tests. Adding a new source = add a new file + register in `core/sources/index.ts`.

---

## 5. Pipeline

```
config.json → load
            ↓
For each enabled SourceAdapter (in parallel):
   fetch() → NormalizedJob[]   (one adapter failure = logged warning, not fatal)
            ↓
Combined pool of NormalizedJob[]
            ↓
dedupe()    (v0: exact-id Map; future: URL + title+company hash)
            ↓
filter()    (drop if: location mismatch, below salary floor, blocklisted company,
            seniority >= 2 steps off the candidate's level)
            ↓
rank()      (PURE DETERMINISTIC: weighted keyword overlap between profile.skills
             and JD text × recency-boost = max(0.5, 1 - daysOld/30).
             NO LLM call. The client AI does deeper relevance reasoning if it
             chooses, after reading the digest.)
            ↓
Take top K (default 10)
            ↓
format()    → digest-{YYYY-MM-DD}.md + digest-{YYYY-MM-DD}.csv
```

`rank()` returns a `RankedJob` (NormalizedJob + score + score breakdown). `breakdown` carries `keywordOverlap` and `recencyBoost` only — no `llmFitScore` field is populated in Design B. The Phase 1 code in `rank.ts` retains the LLM-fit-score code path for backward-compatibility but the MCP server never enables it; flag `ranking.useLlmFitScore` is hardcoded to `false` in the loaded config.

---

## 6. Output format

**Markdown** (primary, for human reading):

```markdown
# JobHelp daily digest — 2026-05-14

10 ranked jobs from 3 sources. Run took 42s. Cost: $0.018.

## #1 Software Engineer I — Stripe (score 0.87)
- **Source:** greenhouse
- **Location:** Remote (US) · $130k-$180k
- **Posted:** 2026-05-13 (1 day ago)
- **Why this match:** {LLM rationale, 1-2 sentences}
- **Apply:** https://stripe.com/jobs/listing/...
- **One-click tailor:** `/tailor stripe-swe-i`

## #2 ...
```

**CSV** (secondary, for spreadsheet workflow): tabular form with columns `rank,score,source,company,title,location,remote,salaryMin,salaryMax,postedAt,url,id`. Opens directly in Google Sheets / Excel.

Both saved to `${config.output.dir}/digest-{YYYY-MM-DD}.{md,csv}` (default `~/jobhelp/digests/`).

---

## 7. Tailoring in any MCP client (client-AI orchestration)

The extension's one-click-tailor calls Apps Script with the user's Anthropic API key. That flow keeps working unchanged for the Chrome-side use case.

For the MCP path, **the server does NOT have a `tailor_resume` tool that does the LLM work**. Instead, the client AI orchestrates the entire flow using server-exposed tools and resources. The MCP tools are deterministic data primitives; the MCP resources are the rule files and source dump; the AI's reasoning is what produces the resume.

**Tools the server exposes for tailoring workflow:**
- `init_config({ interactive? })` — first-run helper. When interactive, the AI walks the user through each config field (Adzuna keys, Greenhouse tokens, Lever slugs, profile location/salary, rules mode); writes `~/.config/jobhelp/config.json`. Or the user can hand-edit the file. Both work.
- `register_resume({ name, path?, content? })` — add a resume to the registry under a friendly name (e.g., `backend`, `ml-engineer`, `frontend`). Supports any number of resumes. Persisted across MCP-server restarts in `~/jobhelp/state.json` (registry index) with the actual markdown stored at `~/jobhelp/resumes/{name}.md`.
  - **Input format:** server stores markdown only. If the user has a PDF/DOCX, the client AI extracts it to markdown (the AI's own multimodal / file-reading capability handles this), then passes the extracted text as `content`. The server doesn't need PDF/DOCX parsing libraries.
  - **Round-trip-edit flow:** server can return the registered markdown to the user/AI for inline editing. AI presents it in chat, user adds/removes info, AI re-calls `register_resume` with updated content (same name overwrites).
- `set_active_resume({ name? })` — switch the active resume. With no name, returns the list of registered resumes for the AI to surface.
- `find_matching_jobs({ resumeName?, useAllResumes?, queries, instructions?, count? })` — discover → score against the named resume OR (if `useAllResumes`) against the union of skills across ALL registered resumes → return ranked digest. The client AI can then choose, per job, which resume's skillset is most relevant. `queries` is the inline list of search strings (e.g., `["entry level software engineer", "junior backend python"]`) — passed every call, not persisted in config. `instructions` is free-text ad-hoc guidance.
- `get_latest_digest()` — return the most recent persisted digest. Useful when the AI references "yesterday's #3" — resolves without re-running discovery. Server persists each digest to `~/jobhelp/digests/digest-{YYYY-MM-DD}.json` plus a `latest.json` symlink/pointer.
- `get_job(id)` — return a NormalizedJob (or full JD text) by id from a recent digest run
- `read_rules({ mode? })` — return rule files. Mode: `defaults` (the 15 bundled), `user` (the user-rules-dir only), or `merged` (defaults + user, user wins on conflict). Default `merged`.
- `read_resume()` — return the active resume content (resolved from path or stored inline)
- `score_keyword_match(resumeMarkdown, jobId)` — deterministic 0..1 overlap score for the client to verify ATS coverage
- `start_application({ jobId, basedOnResumeName? })` — create `~/jobhelp/applications/{company-role-date}/` if missing, return its path; idempotent. Records which registered resume the application was based on.
- `write_application_output({ jobId, kind, content })` — single tool covers all artifact kinds. `kind ∈ {resume, cover-letter, critique, notes}`. Versioning behavior per kind: `resume` and `cover-letter` → always write next available version (`resume.v1.md` → `resume.v2.md` → ...). `critique` and `notes` → overwrite. Returns the path written.
- `list_application_versions({ jobId, kind })` — list versions for diff/recovery
- `list_recent_applications()` — return history from `~/jobhelp/state.json`

**Directory naming convention (locked):** `~/jobhelp/applications/{company-slug}-{role-slug}-{YYYY-MM-DD}/`, e.g. `doordash-swe-i-2026-05-15/`. Slugs lowercased, non-alphanumeric → `-`, collapsed.

**Output format (v1):** all artifacts written as **markdown** only. ⚠️ **TODO_FUTURE: DOCX + PDF rendering** is a critical follow-up — eliminates the friction of the user manually re-formatting for actual submission. Likely implemented as a `render({ jobId, kind, format })` tool that converts the stored `.md` to `.docx` and `.pdf` on demand, or as a separate render step in the existing Apps Script DOCX pipeline. Not blocking v1; flagged as the highest-leverage v1.5 add.

**Config-or-fail behavior:** if `~/.config/jobhelp/config.json` is missing on any tool call other than `init_config`, the server returns a typed error pointing the user to run `init_config` (interactively walks them through setup) OR to hand-create the file. The server does NOT silently create defaults.

**Unconfigured-adapter behavior:** when a source adapter has missing/invalid auth (e.g., user has no Adzuna keys), `find_matching_jobs` still runs the other adapters but the response includes a `warnings: [{ source, message }]` array surfacing which sources were skipped and what keys are missing. Surfaced prominently in the digest output so the user sees it immediately, not buried in logs.

**Custom-rules conflict resolution:** deferred (no key conflict logic for v1). Server reads everything in `~/jobhelp/rules/` and concatenates per the `rules.mode` config; if filename collisions matter to the user in the future, we'll add a deterministic resolution policy then.

**Application status tracking:** deferred. Server records which artifacts were written (resume.v1.md, cover-letter.v1.md, etc.) but does NOT auto-mark jobs as `applied`. If the user wants explicit status, a future `update_application_status` tool can be added; for v1, the file presence is the implicit status signal.

**Custom user rules location:** default `~/jobhelp/rules/`. Server reads any `.md` files there as user-supplied rules. Path overridable via `config.rules.userRulesDir`.

**Resources the server exposes for prompt context:**
- `jobhelp://rules/defaults` — the 15 bundled rule files
- `jobhelp://rules/user` — the user's custom rules folder (configurable path), if any
- `jobhelp://rules/merged` — defaults + user-rules (user wins on direct conflict)
- `jobhelp://resume` — the active resume content (from `set_active_resume`)
- `jobhelp://recent-digest` — the latest digest as structured data
- `jobhelp://state` — recent applications index

**User-rules modes (configurable, full user control):**
- `defaults_only` — bundled rules only; user rules ignored even if present
- `additive` — defaults + user rules; user wins on conflicting H1
- `replace` — user rules ONLY; defaults ignored entirely

**Example interaction (any MCP client):**
```
User (first run): "Use this resume from now on: ~/Documents/my-resume.md"
Client AI: calls set_active_resume({ path: "~/Documents/my-resume.md" })
Server: stores path, validates file exists, returns confirmation.

User: "Find me jobs that match it, then tailor for the top one. Emphasize my Go experience."

Client AI:
  1. calls find_matching_jobs({ instructions: "emphasize Go" }) → ranked digest
  2. presents top 3 to user; user picks #1
  3. calls get_job("greenhouse:doordash:abc123") → full JD
  4. loads jobhelp://rules/merged and jobhelp://resume into its prompt context
  5. generates tailored resume markdown IN ITS OWN SESSION using rules + instructions
  6. calls score_keyword_match(generated_resume, job_id) → 0.84
  7. critiques own draft against rule-file 8-dimension rubric
  8. revises bullets the critique flagged → final markdown
  9. calls start_application(job_id) → returns ~/jobhelp/applications/doordash-swe-i-2026-05-15/
  10. calls write_application_output({ jobId, kind: "resume", content }) → resume.v1.md
  11. optionally generates cover letter + verify-hooks, writes those too
```

The user can also paste their resume content directly into the chat — the client AI keeps it in its own session context and passes the content (not a path) to tools that need it. Either input mode works.

The "intelligence" — rule-following, bullet rewriting, critique judgment, revision — lives in the client AI's session. The server's job is to (a) give the client the right context (rules + dump + JD) and (b) persist whatever the client produces. **No `anthropic.messages.create` call anywhere in the server.**

---

## 8. Configuration

User config: `~/.config/jobhelp/config.json` (XDG-friendly, override via `JOBHELP_CONFIG` env)

```json
{
  "profile": {
    "resume_dump_path": "~/Documents/resume-dump.md",
    "skills": ["typescript", "go", "python", "..."],
    "location": "Irvine, CA",
    "remote_ok": true,
    "salary_floor": 100000,
    "seniority": "entry",
    "role_family": ["backend", "fullstack", "ai-engineer"]
  },
  "sources": {
    "adzuna": {
      "appId": "...",
      "appKey": "...",
      "country": "us",
      "queries": ["software engineer entry level", "junior software engineer"]
    },
    "greenhouse": { "tokens": ["doordash", "stripe", "openai"] },
    "lever":      { "slugs":  ["plaid", "anthropic", "mercury"] }
  },
  "ranking": {
    "useLlmFitScore": false,           // Design B: never set true
    "topN": 20,
    "digestK": 10
  },
  "output": {
    "dir": "~/jobhelp/digests"
  }
  // NO "anthropic" block. Server makes no LLM calls.
}
```

The MCP server uses an `init_config` tool (or a one-shot `npx @jeffreyp1/jobhelp-mcp init`) to create a starter config in the user's home directory. The starter config has no API-key field at all.

---

## 9. Error handling

Per CLAUDE.md's no-silent-failure rule:

- Every adapter `fetch` wrapped in try/catch; failures logged with `{ source, error, context }` and return `[]`
- The orchestrator collects per-source `{ jobsCount, errors }`; the digest header lists which sources succeeded / failed
- If ALL sources fail, the run returns a typed error: `{ ok: false, error: { type: 'all_sources_failed', sources_attempted, last_error } }`
- Structured logger (`core/lib/log.ts`) with API-key redaction (regex match on `/sk-ant-[a-zA-Z0-9_-]{20,}/` and any field name matching `/api[-_]?key|token|secret|password/i`)
- Logs go to `~/.config/jobhelp/log.jsonl` (configurable) + stderr when run interactively

---

## 10. Testing strategy

- Each adapter has a vitest unit test with a recorded HTTP fixture (`tests/fixtures/{adzuna,greenhouse,lever}-response.json`)
- Pipeline integration test: feed 3 fixture sources through the full pipeline, snapshot the resulting digest markdown and CSV
- No live HTTP in CI; live runs are manual only

---

## 11. Deployment matrix

Primary surface is the MCP server. It works in every MCP-compatible client without modification because no client is "blessed."

| Client | Install snippet | LLM bill goes to |
|--------|-----------------|------------------|
| **Claude Code** | `claude mcp add jobhelp -- npx -y @jeffreyp1/jobhelp-mcp` | User's Claude Max plan (zero marginal cost) |
| **Claude Desktop** | edit `~/Library/Application Support/Claude/claude_desktop_config.json` | User's Claude Max plan |
| **Cursor** | edit `.cursor/mcp.json` (project) or `~/.cursor/mcp.json` (global) | User's Cursor Pro |
| **Zed** | settings.json → `assistant.mcp_servers` | Whatever Zed is configured with |
| **Codex / VS Code Continue / Aider / etc.** | per-client MCP config | The respective client's billing |

**A user installs once, uses with whichever model their plan covers. No per-user API key, no signup flow, no marginal cost to the JobHelp author.**

**Deferred / out of scope for v1:**
- **Standalone CLI** — confirmed dropped (Q2). The cron use case isn't required.
- **Dedicated Claude Code skill** (separate SKILL.md) — the MCP server already works in Claude Code; a slash-command wrapper is sugar, not necessary for v1.
- **Dropping `@anthropic-ai/sdk`** — kept in the deps for now (Q5) in case anyone wants Design A as an opt-in. `core/lib/claude.ts` stays dormant; the MCP server never imports it.

---

## 12. Phase plan (revised for Design B)

**Phase 1 — Core library (DONE, merged on `job-digest/integration`):**
- Sources adapters (Adzuna/Greenhouse/Lever) — pure HTTP fetch, fault-isolated
- Pipeline (normalize/filter/dedupe/rank) — deterministic; the LLM fit-score code path EXISTS but will be disabled in MCP usage
- Digest generator + markdown/CSV formatters
- Logger + config loader
- 153 tests, tsc strict, karen-chain validated
- **Carries over to Design B:** all of `core/sources/`, `core/pipeline/{normalize,filter,dedupe}.ts`, `core/digest/`, `core/lib/{log,config}.ts`
- **Removed in Design B:** `core/lib/claude.ts`, the `useLlmFitScore` path in `rank.ts`, the `anthropic` block in config

**Phase 2 — MCP server (NEW Phase 2; primary deliverable):**
- `mcp/src/index.ts` — stdio MCP bootstrap, using `@modelcontextprotocol/sdk`
- `mcp/src/tools.ts` — wraps `core/` functions as MCP tools (see §7 list)
- `mcp/src/resources.ts` — exposes rule files + resume dump + recent digests as MCP resources
- `init` subcommand creates starter config (no API key)
- Drop `@anthropic-ai/sdk` from deps; drop `core/lib/claude.ts`; force `useLlmFitScore: false` in loaded config
- Test against Claude Code (this CLI), Claude Desktop, and at least one third-party client (Cursor)
- Publish to npm as `@jeffreyp1/jobhelp-mcp`

**Phase 3 — Polish + distribution (replaces old Phase 4):**
- README with per-client install snippets (Claude Code / Desktop / Cursor / Zed / Codex / Continue)
- 60-90s demo video showing the same tool call in 2-3 different clients
- Activate `usajobs` adapter (free, just needs API key for the JOB BOARD itself; the LLM constraint doesn't apply)
- Document the Design-A → Design-B migration for anyone who started with the Phase-1 scaffolds

**Phase 4 (deferred):**
- Cascade matching algorithm (BM25F + embeddings + RRF) — embeddings would require a free-tier vendor or local model; deferred until needed
- URL-canonical + title+company-hash dedup
- Standalone CLI for cron-able batch (only if user wants deterministic-only digest output without an MCP client running)
- Cover-letter-specific tooling (the existing v2 feature in Apps Script covers it for the extension path; MCP path uses the client AI directly)

---

## 13. Open questions / risks (Revision 2)

- **Rule files in the npm package.** Bundling `prompts/shared/*.md` as MCP resources means rule updates require a new release. Acceptable for now. Alternative: serve rules from the user's local filesystem (a config option). Revisit if iteration speeds up.
- **Adzuna free-tier rate limits.** 1000 calls/month. Daily runs × multiple queries could brush the ceiling. Cache responses, add a `lastFetchedAt` guard.
- **Client-side context limits.** The full rule-files-resource (~1100 lines) plus resume dump (~18KB) plus a JD (~2KB) is roughly 8-10K tokens of prompt context. Fine for all modern model context windows but worth measuring.
- **Determinism gap.** With Design A, the same JD + dump + rules would produce nearly identical resumes across runs (model determinism + caching). With Design B, the resume varies with the client model and its session state. Trade-off: portability vs reproducibility. Acceptable for personal use; flagged.
- **Phase 1 code carrying dead branches.** `core/lib/claude.ts` and the LLM-fit-score path in `rank.ts` exist in the merged code. Phase 2 either removes them or leaves them as dormant (configurable-off). Decide based on whether anyone in the future wants the Design-A behavior as an opt-in.

---

*End of design spec.*
