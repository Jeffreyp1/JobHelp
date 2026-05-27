# CLAUDE.md — working agreement for agents on JobHelp

Read this before touching anything. It applies to the main session AND to every dispatched subagent.

## What JobHelp is

A personal-use job-application tool. Chrome extension (Manifest V3, side panel, TypeScript, esbuild) + a Google Apps Script backend (paste-deployed single `Code.gs` bundle). The extension scrapes a job description from the current page (working scrapers for LinkedIn / Indeed / Greenhouse / Lever / Workday / Ashby / generic HTML), the backend calls the Anthropic API with prompt caching + a set of load-bearing rule files to produce a tailored resume in Markdown, writes outputs to a per-job Google Drive folder, can export DOCX/PDF and fill a user-supplied DOCX template, and logs every application to a Google Sheet. Seven optional v2 features layer on top (company research, LinkedIn role benchmark, critique pass, auto-revise, cover letter, verify-CL-hooks, multi-version). Single-file Drive config (`jobhelp-config.json`) is the v2.1 setup model; legacy per-machine `chrome.storage` keys are mirrored from it as a derived cache.

## Repo layout

```
extension-app/appsscript/src/
  Code.ts                 doPost router + all action handlers' dispatch
  handlers/               one file per action (research, benchmark, critique, autoRevise,
                          coverLetter, verifyHooks, multiVersion, createDriveFile, ...)
  message-builder.ts      shared user-message composition (generate + multiVersion)
  drive.ts                DriveOps implementation (Drive/Docs/Sheets)
  claude.ts               the only place UrlFetchApp hits the Anthropic API
  prompt.ts               composeSystemPrompt from rule files
  cost.ts                 pricing table + cost calc
  lib/structuredLog.ts    leveled logger with secret redaction (USE THIS, not console.*)
  types/                  api-contract.ts (the wire shape), drive-ops.ts, claude-api.ts, job-insights.ts
extension-app/appsscript/tests/         vitest; mocks GAS globals
extension-app/appsscript/scripts/build.mts   bundles -> extension-app/appsscript/dist/Code.gs

extension-app/extension/src/
  sidepanel/tabs/         generate.ts (orchestration), settings.ts, files.ts
  sidepanel/features/     one UI module per v2 feature + their renderers
  sidepanel/components/   toggleRow, resumeEditor (Edit/Preview), costEstimator, jobInsights, ...
  sidepanel/index.ts      panel entry point; owns getRuntimeConfig() + the message-bus hooks
  sidepanel/onboarding-wizard.ts
  background.ts           MV3 service worker; handles generate/finalize/list_files/etc.
  lib/                    apiClient, configLoader, configMigration, configCrypto,
                          structuredLog, templateFiller, costCalculator, storage, scraper
  types/                  api-contract.ts (SOURCE OF TRUTH; mirrored to the appsscript copy),
                          storage-schema.ts, jobhelp-config.ts, message-bus.ts
extension-app/extension/tests/          vitest; jsdom env; chrome mock helpers
extension-app/extension/scripts/build.mts    bundles -> extension-app/extension/public/{sidepanel/index.js, background.js, scraper.bundle.js}

extension-app/prompts/shared/           15 rule files; 6 are load-bearing (flagged in frontmatter + H1)
docs/                     CHANGELOG.md, v2-features.md, security.md, setup-for-new-users.md,
                          superpowers/plans/*, superpowers/reviews/* (audits), research/*
scripts/                  test-handler.mts (CLI to POST any action), verify-bundle.mts,
                          smoke-test.mts, iterate-template.mts
extension-app/tests/contracts/, extension-app/tests/smoke/   black-box wire-shape tests + post-build smoke
vitest.config.ts          include globs: extension-app/extension/tests/**,
                          extension-app/appsscript/tests/**, extension-app/tests/**,
                          extension-app/prompts/**, jobhelp-mcp/tests/**
```

## Commands

- Tests: `npx vitest run` (run from the repo root — running from inside `extension-app/extension/` or `extension-app/appsscript/` picks up a different cwd and surfaces spurious failures).
- Type check: `npx tsc --noEmit` (must be clean; run from repo root).
- Build extension: `node extension-app/extension/scripts/build.mts`. Build Apps Script: `node extension-app/appsscript/scripts/build.mts`.
- Post-build sanity: `node scripts/verify-bundle.mts` (builds both + 12 checks: bundle sizes, manifest schema, version match against CHANGELOG, all action strings present in `Code.gs`).
- Hit a deployed backend: `APPS_SCRIPT_URL=... node scripts/test-handler.mts ping` (or any action).

A change isn't done until `npx vitest run` is fully green AND `npx tsc --noEmit` is clean AND both bundles build. State the actual command output before claiming success — don't assert, verify.

## Conventions

- TypeScript everywhere. `tsc --noEmit` must stay clean on both packages.
- Default to **no comments**. Add one only when the *why* is non-obvious (a hidden constraint, a workaround for a specific bug, a load-bearing invariant). Never narrate what the code does. Never reference the task/PR/agent in a comment.
- No emoji in code, docs, or commits unless the user explicitly asks.
- Don't create docs (`*.md`) unless asked. Don't create planning/analysis files unless asked.
- File length ceiling: **300 lines per source file** (excluding pure data files, fixtures, and snapshot tests). When a file exceeds 300 lines, split it before adding more. Preferred splits, in order: (a) extract a sibling module by cohesive responsibility (e.g., one handler file → handler + helpers + types); (b) move pure functions into `lib/`; (c) pull large type definitions into `types/`; (d) split tests by surface (`handler.test.ts` → `handler.success.test.ts` + `handler.errors.test.ts`). Re-export the original public surface from the original path so existing imports stay intact. The 300-line cap is for readability and reliable LLM-context editing — a 600-line file gets edited worse than two 300-line files.
- Logging: use `log(level, msg, ctx)` from `lib/structuredLog.ts` (both packages have one). Pass structured context objects (`{ company, role, cost, error }`) — don't string-interpolate; the logger redacts API keys and truncates >2 KB automatically. Levels: `info` = milestones, `debug` = chatter, `warn` = recoverable degradation, `error` = a broken flow. Don't double-log (don't `console.error` then return a typed error too — replace, don't add).
- Error policy in handlers: never throw across the HTTP boundary. Return `ApiResult<T>` = `{ ok: true, ... } | { ok: false, error: { type, message, retryable } }`. `error.type` is the union in `api-contract.ts`; `retryable` is true only for `rate_limit` and `server`. Forward `err.errorType` verbatim from a `ClaudeApiError` — do not collapse `rate_limit` into `server`.
- `api-contract.ts` exists in two copies: `extension-app/extension/src/types/api-contract.ts` is the SOURCE OF TRUTH; `extension-app/appsscript/src/types/api-contract.ts` is a manual mirror. If you change one, change the other byte-identically (except the file-header comment, which legitimately differs). JSDoc-only changes are fine; type-signature changes ripple — be deliberate.
- Apps Script V8 runtime: NO `Promise.all`, no `async`/`await` in the request path (it's synchronous), no Node APIs. The `Code.gs` bundle is paste-deployed by the user — anything you add must be esbuild-inlinable (same module system as everything else). `ContentService`, `DriveApp`, `DocumentApp`, `SpreadsheetApp`, `UrlFetchApp`, `CacheService`, `ScriptApp`, `Utilities` are GAS globals — guard for `typeof X === 'undefined'` in code that also runs under vitest.
- Cache keys that include user-supplied strings must be collision-safe — encode tuples (`JSON.stringify([company, role])`), don't `${company}:${role}`.
- `git`: only commit when the user asks. Never `--no-verify`, never force-push to main, never amend a published commit, never skip hooks. No "Co-Authored-By" trailers unless asked. New commits, not amends.

## Parallel-agent discipline (read this twice)

When you're dispatched as one of several parallel agents, you have an **assigned file set** — the files your prompt says you OWN (may modify/create) and a FORBIDDEN list (everything else, or an explicit list). The whole point of file-level isolation is that N agents can work concurrently without stepping on each other. Violating it corrupts the merge.

Hard rules:

1. **Do not edit a file you weren't assigned.** Not even a one-line "while I'm here" fix. Not even to make your own tests pass. Not even if it's "obviously broken." If a file outside your scope has a bug that blocks you, you do NOT fix it — you work around it within your owned files if you can, and you FLAG it in your report (see below). Another agent owns that file; your edit will collide with theirs.

2. **Do not "fix" files that another agent is creating or modifying.** If you see a half-finished file, a failing test in someone else's test file, a type error in a file you don't own — leave it alone. It's almost certainly an in-flight change from a sibling agent that hasn't landed yet. Touching it creates a conflict; "fixing" it may revert their work.

3. **Don't run the build/tests and then "repair" the tree.** It's normal for the full suite to be temporarily red while sibling agents are mid-flight (a forbidden test file may fail, a forbidden source file may have a tsc error). That is NOT your job to fix. Verify only that *your owned files* compile and *your owned/added tests* pass. If the only failures are in files you don't own, report "my files clean; pre-existing/in-flight failures in <list> are not mine" and stop.

4. **New shared types or APIs you need from a sibling agent**: don't reach into their file. Either (a) the orchestrator told you the API and you code against it guarded (`if (typeof apiClient.newThing === 'function')`), or (b) you FLAG the dependency. Don't pre-emptively add the thing yourself in their file.

5. **Cross-impact flag format**: when your work implies a change to a file outside your scope, write a line in your report prefixed `CROSS-IMPACT:` naming the exact file and the change needed, with enough detail (file:line, before/after sketch) that the orchestrator can apply it. Do NOT apply it yourself.

6. **Test files**: only add/modify tests in test files you own. If a sibling-owned test file has a stale assertion because of YOUR change, that's a cross-impact — flag it, don't edit their test file. Failing-by-design probe tests (ones written to fail until a bug is fixed) belong to whoever owns them; don't flip them unless you own that file AND you fixed the underlying bug.

7. **When in doubt, do less.** A smaller, cleanly-scoped change that the orchestrator can integrate beats a sprawling one that touches forbidden files and has to be unpicked.

Report format every agent uses on completion (keep it tight):
- **What you created/changed** — file-by-file, one line each.
- **What you tested** — test names added/modified, count delta, the actual `npx vitest run` tail, tsc result, build result.
- **Your approach** — the design decisions you made and why.
- **Cross-impacts / follow-ups** — `CROSS-IMPACT:` lines for forbidden-file changes you need; anything you couldn't finish; pre-existing/in-flight breakage you observed but (correctly) didn't touch.

## Gotchas worth knowing

- `generate.ts` imports `getRuntimeConfig` from `sidepanel/index.ts` (a circular import) — it's safe because `getRuntimeConfig` is only called inside event handlers, esbuild bundles both into one file, and importing `index.ts` under vitest is inert (`init()` early-returns when `#tab-content` is absent).
- The background service worker still reads the legacy `chrome.storage` keys; the side panel mirror-writes them from the loaded Drive config. Don't "clean that up" by deleting the legacy keys — it's load-bearing during the migration window.
- `extension-app/prompts/shared/_validate.test.ts` is now in the vitest include glob — if you change the rule files (count, load-bearing flags, total tokens), update its assertions.
- The 14/15 rule files: rule 13 (output-shape) uses ASCII hyphens in role-header location markers (not em-dashes) because rule 05 caps em-dashes at 2/doc. Don't reintroduce em-dashes there.
- Auto-revise (rule 14) is byte-identity-disciplined: instructions are validated non-whitespace, the fence-stripper does NOT `.trim()` the response (trailing newlines matter), and `computeDiff` LF-normalizes both sides before comparing. Don't undo any of that.
