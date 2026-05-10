# JobHelp — Design Specification

**Date:** 2026-05-09
**Status:** Draft for review
**Owner:** Jeffrey

---

## 1. Purpose & Success Criteria

**Purpose.** A personal-use job-application assistant that takes a job description (auto-scraped from the active browser tab) and N markdown source files (resume content, projects, skills) and produces a tailored, ATS-safe resume — saved to Google Drive as a Doc, logged to a tracking sheet. Initial volume ~25 applications/day. Designed to generalize so other users can drop their own source files and use the same tool.

**Success criteria for v1 MVP.**

| Criterion | Measure |
|---|---|
| Speed | From job page open → tailored resume saved + sheet logged in <15 seconds (excluding model latency) |
| Truthfulness | Zero hallucinated skills, metrics, employers, or dates across a 50-application benchmark |
| ATS-safety | Output passes 12-item self-scan for AI fingerprints; renders cleanly in Workday/Greenhouse parsers |
| Reproducibility | A user-supplied sample resume becomes the structural template for future generations |
| Cost | <$0.01 per application at default Haiku 4.5; <$0.10 with all toggles enabled |
| Generalizability | Documented setup path lets another user install + configure in <30 minutes |

---

## 2. Architecture

**Pattern: thin Chrome extension + fat Apps Script backend (Architecture 2).**

```
┌─────────────────────────┐         ┌─────────────────────────┐
│  Chrome Extension       │         │  Apps Script Web App    │
│  (Manifest V3)          │         │  (User's GAS project)   │
│                         │  POST   │                         │
│  • Side Panel UI        │ ──────► │  • Reads source files   │
│  • Content scraper      │  /exec  │  • Reads rule files     │
│  • Background worker    │         │  • Composes prompt      │
│  • chrome.storage       │ ◄────── │  • Calls Claude API     │
│                         │  JSON   │  • Creates Doc          │
│                         │         │  • Appends sheet row    │
└─────────────────────────┘         └─────────────────────────┘
                                              │
                                              ▼
                                    ┌──────────────────────┐
                                    │  User's Drive folder │
                                    │  /JobHelp/           │
                                    │   source-materials/  │
                                    │   rules/             │
                                    │   outputs/           │
                                    │  /JobHelp Sheet      │
                                    └──────────────────────┘
```

**Why this pattern.** Single source of truth for logic + rules in Apps Script. API key stays in Apps Script Properties, never in extension. Drive ops use OAuth-as-yourself (no GCP project needed). Same backend serves the Claude Code skill if invoked. Extension stays lean — its only job is capture + display + relay.

**Alternatives considered and rejected:** fat extension + thin Apps Script (rejected: API key in extension, harder to update logic), extension + Cloudflare Worker + Apps Script (rejected: more infra without proportional value for personal use).

---

## 3. Module Boundaries

### Extension (`/extension`)

| Module | Purpose | Public interface |
|---|---|---|
| `manifest.json` | MV3, side panel + scripting permissions, host permissions for `<all_urls>` | — |
| `src/background.ts` | Service worker; tab event listener; scrape orchestration; message bus router | listens to `chrome.tabs` events, routes to `messageBus` |
| `src/scraper.ts` | DOM extraction per site + generic fallback + JD section splitter + skills extraction | `scrapePage(): Promise<ScraperOutput>` |
| `src/sidepanel/index.ts` | Side panel entry — tab navigation, state coordination | reads `chrome.storage`, calls `apiClient` |
| `src/sidepanel/tabs/{generate,files,settings}.ts` | Per-tab logic | imports from components/ |
| `src/sidepanel/components/{toggleRow,jobInsights,resumeEditor,costEstimator}.ts` | Reusable UI components | each exports a `render(state) -> HTMLElement` |
| `src/lib/apiClient.ts` | Talks to Apps Script web app over fetch | `generate(req: GenerateRequest): Promise<GenerateResponse>` |
| `src/lib/messageBus.ts` | Typed wrapper over `chrome.runtime.sendMessage` | `send`/`on` for typed messages |
| `src/lib/storage.ts` | Typed wrapper over `chrome.storage.local` | `get<K>(k)`/`set<K>(k,v)` |
| `src/lib/skillsDict.ts` | Lightcast/ESCO skills lookup | `loadSkillsDict()`, `findSkillsInText(text)` |
| `src/lib/costCalculator.ts` | Live cost estimation from toggles + model | `estimateCost(config): number` |
| `src/lib/tokenEstimator.ts` | Approximate tokenizer (chars/4) | `estimateTokens(text): number` |
| `src/lib/presetManager.ts` | Save/load named toggle presets | `save`/`load`/`list` |
| `src/types/*.ts` | Interface contracts (api-contract, scraper-output, storage-schema, message-bus, job-insights) | exported types |

### Apps Script (`/appsscript`)

| Module | Purpose | Public interface |
|---|---|---|
| `src/Code.ts` | `doPost` HTTP entry; action router (generate / list_files / seed_defaults / etc.) | `doPost(e): GoogleAppsScript.Content.TextOutput` |
| `src/claude.ts` | Claude API caller with prompt caching | `callClaude({system, user, model})` |
| `src/prompt.ts` | Compose system prompt from rule files | `composeSystemPrompt(ruleFiles): string` |
| `src/drive.ts` | Drive folder reads/writes | `readSourceFiles`, `readRuleFiles`, `writeOutput` |
| `src/seed.ts` | First-run: copy 12 rule files from GitHub raw URLs into user's Drive | `seedDefaults(folderId)` |
| `src/sheet.ts` | Append row to tracking sheet | `appendSheetRow(metadata)` |
| `src/tokens.ts` | Token estimator | `estimateTokens(text): number` |
| `src/types/*.ts` | Apps Script-side interfaces (api-contract, drive-ops, claude-api) | exported types |

### Prompts (`/prompts/shared/`)

12 markdown rule files. Source of truth for both extension and Claude Code skill. User-editable in Drive (after first-run seeding).

### Claude Code (`/claude-code`)

`.claude/skills/tailor-resume/SKILL.md` consumes the same `prompts/shared/*.md` files via reference.

---

## 4. Data Flow (one generation call)

```
1. User clicks Generate in side panel
2. sidepanel.ts gathers state: { jd, company, role, url, jobInsights, toggles, modelChoices }
3. POSTs to Apps Script /exec with {action: "generate", ...state}
4. Apps Script doPost validates request shape
5. Apps Script reads ALL .md files in /JobHelp/source-materials/  (cached 10 min via CacheService)
6. Apps Script reads ALL .md files in /JobHelp/rules/             (cached 10 min)
7. composeSystemPrompt(ruleFiles) → cached system message
8. buildUserMessage(sourceFiles, jd, jobInsights) → user message
9. callClaude(systemPrompt, userMsg, model)
10. Parse Claude response: { resume_md, keyword_coverage, missing_skills, reframings_applied }
11. drive.writeOutput("Tailored Resume — {company} — {date}", resume_md)
12. sheet.appendRow({ company, role, url, docUrl, date, model, cost })
13. Return { docUrl, sheetRowUrl, resume_md, keyword_coverage, missing_skills, ... } to extension
14. Side panel renders editable resume + coverage card + Save button
```

**Auto-rescan flow (no API call):**

```
Tab change detected → background.ts fires onActivated
   ↓
chrome.scripting.executeScript injects scraper into active tab
   ↓
scraper.ts runs DOM extraction + skillsDict lookup
   ↓
ScraperOutput { jd, company, role, url, jobInsights } returned via message
   ↓
side panel updates Job Insights card + JD textarea
   (No API call — purely local; ~50-100ms total)
```

---

## 5. Error Handling

| Failure mode | Behavior |
|---|---|
| Scraper finds nothing | Empty JD textarea with "Paste JD here" placeholder; Job Insights card shows "no job detected" |
| Apps Script unreachable | Toast: "Backend unreachable. Check Apps Script URL in Settings." |
| Claude API rate limit (429) | Toast with retry-after; resume button stays clickable |
| Claude API auth error (401) | Toast: "Check API key in Settings." |
| Source materials > 25K tokens | Hard block: "Source materials exceed cap. Trim in Drive." |
| Rule files missing in Drive | Auto-trigger first-run seeding from GitHub raw URLs |
| Drive folder ID invalid | Settings prompts user to re-pick folder |
| GitHub raw URL fetch fails | Partial seed allowed; toast: "Could not fetch N defaults. Retry from Settings." |
| User edits JD after Generate, before Save | Indicator: "edits pending"; Save uses latest text; no re-call |
| Tab change during generation | In-flight call completes; Job Insights card updates for new tab; user is notified if outputs no longer match |

**Pattern:** all user-visible errors become toasts in the side panel with a one-line action. No silent failures. No raw stack traces.

---

## 6. Testing Strategy

Per `/test-driven-development` skill: tests written before implementation for every pure function. UI exempt from TDD; uses manual test checklist.

| Test scope | Tooling | What gets tested |
|---|---|---|
| Pure JS/TS functions | Vitest + jsdom | scraper logic, prompt composer, token estimator, cost calculator, preset manager, skills dict |
| Apps Script modules | Vitest with mocked GAS globals (`DriveApp`, `UrlFetchApp`, `SpreadsheetApp`) | Drive ops, Claude API caller, sheet appender, doPost router |
| Integration | Vitest + recorded HTTP fixtures | end-to-end scrape → API → response handling |
| UI | Manual checklist | tab navigation, panel responsiveness, edit flows |
| Prompt regression | "Golden output" fixtures committed to repo | 3 sample JDs × 1 source-materials.md → frozen expected outputs; diff on prompt changes |

**Discipline:** every pure function gets a failing test FIRST, then implementation. Each test name is in the agent's instruction list.

---

## 7. Repo Layout

```
JobHelp/
├── README.md
├── SETUP.md
├── package.json                                  ← pnpm workspaces
├── tsconfig.json
├── .eslintrc.json
├── .prettierrc
├── docs/
│   └── superpowers/
│       └── specs/
│           └── 2026-05-09-jobhelp-design.md      ← this doc
├── prompts/
│   └── shared/
│       ├── _validate.test.ts
│       ├── 01-priority-hierarchy.md
│       ├── 02-anti-fabrication.md                 ← LOAD-BEARING
│       ├── 03-banned-words.md
│       ├── 04-banned-phrases.md
│       ├── 05-structural-rules.md
│       ├── 06-bullet-construction.md              ← LOAD-BEARING
│       ├── 07-reframing-strategies.md
│       ├── 08-bridge-language.md                  ← LOAD-BEARING
│       ├── 09-section-structure.md
│       ├── 10-cover-letter-industry.md
│       ├── 11-self-scan-checklist.md              ← LOAD-BEARING
│       └── 12-template-reproduction.md
├── extension/
│   ├── public/
│   │   ├── manifest.json
│   │   ├── icons/
│   │   └── data/skills-dict.json                  ← built from Lightcast/ESCO
│   ├── scripts/
│   │   ├── build.mjs                              ← esbuild config
│   │   └── build-skills-dict.mjs
│   ├── src/
│   │   ├── background.ts
│   │   ├── scraper.ts
│   │   ├── sidepanel/
│   │   │   ├── index.html
│   │   │   ├── index.ts
│   │   │   ├── style.css
│   │   │   ├── tabs/
│   │   │   │   ├── generate.ts
│   │   │   │   ├── files.ts
│   │   │   │   └── settings.ts
│   │   │   └── components/
│   │   │       ├── toggleRow.ts
│   │   │       ├── jobInsights.ts
│   │   │       ├── resumeEditor.ts
│   │   │       └── costEstimator.ts
│   │   ├── lib/
│   │   │   ├── apiClient.ts
│   │   │   ├── messageBus.ts
│   │   │   ├── storage.ts
│   │   │   ├── skillsDict.ts
│   │   │   ├── tokenEstimator.ts
│   │   │   ├── costCalculator.ts
│   │   │   ├── presetManager.ts
│   │   │   └── onboardingState.ts
│   │   └── types/
│   │       ├── api-contract.ts
│   │       ├── scraper-output.ts
│   │       ├── job-insights.ts
│   │       ├── storage-schema.ts
│   │       └── message-bus.ts
│   └── tests/
│       ├── fixtures/                              ← Wave 1 / A3 outputs
│       ├── lib/
│       └── *.test.ts
├── appsscript/
│   ├── appsscript.json
│   ├── .clasp.json
│   ├── scripts/build.mjs
│   ├── src/
│   │   ├── Code.ts
│   │   ├── claude.ts
│   │   ├── prompt.ts
│   │   ├── drive.ts
│   │   ├── seed.ts
│   │   ├── sheet.ts
│   │   ├── tokens.ts
│   │   └── types/
│   │       ├── api-contract.ts                    ← shared shape with extension
│   │       ├── drive-ops.ts
│   │       └── claude-api.ts
│   └── tests/*.test.ts
└── claude-code/
    └── .claude/skills/tailor-resume/
        ├── SKILL.md
        └── references/                            ← symlinks/copies of prompts/shared/
```

---

## 8. Job Insights Parser

**Goal:** extract structured metadata from every job page WITHOUT calling an LLM. Updates reactively on tab change. Persists in side panel as a Job Insights card.

### Metrics extracted

| Metric | Method | Latency target |
|---|---|---|
| Job title | site selectors + `<title>` parsing + JSON-LD | <5ms |
| Company | site selectors + `og:site_name` + JSON-LD | <5ms |
| Location + remote/hybrid | regex over JD text | <2ms |
| Salary range | regex (`\$[\d,]+(\s?-\s?\$[\d,]+)?`) | <2ms |
| Years of experience | regex (`(\d+)\+?\s*years?`) | <2ms |
| Job type (FT/PT/contract) | regex + selector lookup | <5ms |
| Education requirement | regex (`Bachelor's\|Master's\|PhD`) + section context | <5ms |
| Visa / work authorization | regex (`sponsorship\|visa\|US citizen`) | <2ms |
| Top skills (15-25, ranked) | Lightcast/ESCO dictionary match × frequency × section weight | 20-50ms |
| Required vs nice-to-have skills | Section splitter (regex on headers) → bucket extracted skills | <10ms |
| Posted date | `og:article:published_time` / JSON-LD / selector | <5ms |
| Number of applicants (LinkedIn) | site selector | <5ms |
| JD section breakdown | Splitter from `research-prompts.md` | <10ms |

**Total parse time: 50-100ms.** Visually instant.

### Skills extraction strategy

- Lightcast Open Skills CSV (~32K skills with synonyms, free with attribution) bundled as JSON in `extension/public/data/skills-dict.json`.
- Fallback: ESCO (~13K skills, EU dataset, CC-BY) if Lightcast unavailable.
- Indexed into a Map<lowercased_synonym, canonical_form> at extension load.
- Lookup: tokenize JD → Map lookup per token → group by canonical → sort by count desc.
- Multi-word skills (e.g., "machine learning") use sliding-window scan.

### Reactive flow

```
chrome.tabs.onActivated / onUpdated event
  → background.ts injects scraper.ts into active tab
  → scraper.ts builds ScraperOutput { jd, company, role, url, jobInsights }
  → message sent to side panel
  → Job Insights card + JD textarea update
```

If the JD textarea has been edited by the user and differs from the latest scrape, preserve the user's edits but show a "page changed — [rescan now]" link.

### UI representation (Job Insights card)

```
┌─ Job Insights ─────────────────────────────────┐
│ Acme Corp · Senior Engineer · NYC (Hybrid)     │
│ $180k-$220k · 5+ years · BS/MS in CS           │
│ Posted 3 days ago · 47 applicants              │
│                                                 │
│ Top required skills:                            │
│   Python ●●●●●●●  Kubernetes ●●●●●             │
│   AWS ●●●●  Distributed Systems ●●●            │
│                                                 │
│ Nice-to-have: Rust, GraphQL, Terraform         │
│                                                 │
│ ⚠ Sponsorship: NOT mentioned                   │
└─────────────────────────────────────────────────┘
```

---

## 9. Parallel Agent Strategy

The build is structured as three sequential waves, each with multiple agents in parallel. Agents work against TypeScript interface contracts (`extension/src/types/`, `appsscript/src/types/`) so drift fails at compile time, not at integration.

### Wave 1 — Foundations (parallel; no shared files)

| Agent | Model | Goal | Output |
|---|---|---|---|
| **A1** | Opus | Author 12 prompt rule files | `prompts/shared/*.md` |
| **A2** | Sonnet | Build skills dictionary module | `extension/public/data/skills-dict.json`, `extension/src/lib/skillsDict.ts` |
| **A3** | Sonnet | Capture HTML + sample fixtures | `tests/fixtures/**/*` |

### Wave 2 — Modules (parallel; consume Wave 1 + interfaces)

| Agent | Model | Goal | Output |
|---|---|---|---|
| **A4** | Opus | TDD scraper with site-specific selectors + generic fallback + Job Insights builder | `extension/src/scraper.ts` + tests |
| **A5** | Sonnet | TDD Apps Script Drive operations + first-run seeding | `appsscript/src/{drive,seed}.ts` + tests |
| **A6** | Opus | TDD Apps Script Claude API caller + prompt composer + token estimator | `appsscript/src/{claude,prompt,tokens}.ts` + tests |
| **A7** | Sonnet | TDD Apps Script doPost router + sheet logger | `appsscript/src/{Code,sheet}.ts` + tests |
| **A8** | Opus | Build side panel UI: 3 tabs, Job Insights card, toggle UI shell, cost estimator | `extension/src/sidepanel/**/*` + lib utilities |

### Wave 3 — Integration (sequential)

| Agent | Model | Goal | Output |
|---|---|---|---|
| **A9** | Sonnet | Background worker, message bus wiring, integration tests | `extension/src/background.ts`, integration tests |
| **A10** | Sonnet | Onboarding state machine, SETUP.md, README.md | onboarding code, docs |

### TDD cycle per agent (uniform)

Every agent follows:
1. Write failing tests for all behaviors required by the agent's "Definition of done"
2. Run → all fail
3. Implement minimum code to pass first test
4. Run → first test passes
5. Repeat for remaining tests, one at a time
6. Run full agent test suite → all green
7. Run agent-specific manual verification (where applicable)
8. Report Definition of Done achievement

### Conflict prevention

| Risk | Mitigation |
|---|---|
| Two agents edit the same file | File-path partitioning (each agent has exclusive output paths) |
| Two agents make incompatible interface assumptions | TS interface files locked before any module agent dispatched |
| Agent invents an API not in the spec | Agent prompts explicitly list interface files to read first; spec is source of truth |
| Integration agent finds modules don't fit | Each agent must produce a contract test proving its module satisfies the interface |
| Tests in one module break tests in another | Each agent's tests are isolated to its own directory |

### Verification before merge

After each wave:
1. Run agent's tests → green
2. Verify interface contracts → tsc passes across all merged code
3. Spot-check actual code for hallucination or scope creep
4. Merge into main branch
5. Run full test suite

---

## 10. v1 Feature Set

| Feature | v1 | v2 | v3 | v4 | v5 |
|---|---|---|---|---|---|
| Extension + side panel | ✓ | | | | |
| Auto-scrape JD on tab change | ✓ | | | | |
| Job Insights card (skills/salary/YOE/etc.) | ✓ | | | | |
| Editable JD textarea | ✓ | | | | |
| Master-prompt-driven generation (Haiku 4.5) | ✓ | | | | |
| Toggle UI shell with placeholders | ✓ | | | | |
| Live cost estimator | ✓ | | | | |
| Saved presets (chrome.storage) | ✓ | | | | |
| Editable resume preview | ✓ | | | | |
| Save & log to Doc + Sheet | ✓ | | | | |
| Settings tab with Drive links + Reset | ✓ | | | | |
| First-run seeding from GitHub raw URLs | ✓ | | | | |
| Sample template parsing (drag-drop) | ✓ | | | | |
| Critique pass | | ✓ | | | |
| Auto-revise from critique | | ✓ | | | |
| Inline diff per bullet | | ✓ | | | |
| Company research toggle | | | ✓ | | |
| LinkedIn role benchmarking toggle | | | ✓ | | |
| Cover letter generation (Industry only) | | | | ✓ | |
| CL hook verification | | | | ✓ | |
| Multi-version generation | | | | | ✓ |
| Per-feature model selectors UI | | | | | ✓ |
| Self-improving library | | | | | ✓ |

### Claude Code variant (parallel deliverable)

A `tailor-resume` skill that consumes the same `prompts/shared/*.md` files. Capabilities beyond extension:
- Multi-turn branching gap discovery
- Full 8-dimension critique with 5-perspective read-through + Domain Lens
- Parallel sub-agents for company / role / LinkedIn / blog research
- Multi-job batch processing
- Iterative refinement loops via `/edit-resume`-style commands

Ships independently after rule files are stable. No release coupling to extension v1.

---

## 11. Decisions log

| Decision | Rationale |
|---|---|
| Architecture 2 (thin extension + fat Apps Script) | API key safety, single source of truth, free Drive ops |
| Drive-only file editing (no in-extension editor) | 1 hour vs 5 hours of build time; Drive's editor is already excellent |
| Single source-materials folder, equal-weight files | Quality not affected by file split; user organizes as they prefer |
| 10K token soft cap / 25K hard cap | Keeps focus high; Drive concatenation stays under cache benefits |
| Lightcast Open Skills (with ESCO fallback) | Free, comprehensive, high-quality skills taxonomy |
| TypeScript across extension + Apps Script | Interface contracts enforce parallel agent correctness at compile time |
| esbuild over Vite/Webpack | Personal tool, no HMR needed, fastest TS compilation |
| Vanilla DOM (no React/Vue/Svelte) | ~10 components; framework weight + build complexity not justified |
| Vanilla CSS with custom properties | ~200 lines total; Tailwind would be overkill |
| Industry CL only (no Lab/Academic) | Scope discipline; can add later |
| 1-page resume only (no CV mode) | Scope discipline; sample-template parsing covers structural variation |
| No LaTeX output | DOCX is the ATS-preferred format; LaTeX adds significant complexity for marginal benefit |
| 12 rule files in `prompts/shared/` | Single source of truth; both consumers compose from same files |
| First-run seeds rules to user's Drive | User-owned, user-editable; "Reset to defaults" pulls fresh from GitHub raw URLs |

---

## 12. Open questions / risks

- **Lightcast CSV access:** if Lightcast's free CSV is paywalled at build time, fall back to ESCO. Confirmed in A2 agent's prompt.
- **Anthropic API rate limits at 25/day:** likely not a concern for personal use, but if hit, surface clearly in UI.
- **Apps Script execution time limits (6 min):** generation calls should comfortably stay under 30s; mitigated.
- **Drive caching staleness:** 10-minute CacheService TTL is aggressive; user-edited rule files may take up to 10 min to apply. Acceptable trade-off; "Reset cache" button can be added if needed.
- **Scraper drift:** job sites update their selectors. Generic fallback + manual selector updates in `scraper.ts` are the maintenance plan. Selector tests against fixtures should catch breakage early.
- **Self-improving library (v5):** out of scope for v1 but design accommodates appending to source materials post-generation.

---

*End of design doc.*
