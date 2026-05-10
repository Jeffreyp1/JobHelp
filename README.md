# JobHelp

Chrome extension that tailors your resume to job descriptions and logs applications to a Google Sheet.

## What it does

- **Auto-extracts** job metadata from job pages (LinkedIn, Indeed, Greenhouse, Lever, Workday, Ashby, generic HTML) — no LLM, ~50-100ms parse time — skills, salary, YOE, location, visa, applicant count
- **Generates** a tailored resume from your master source materials using Claude (Haiku 4.5 by default)
- **Saves** the output as a Google Doc in your Drive, logs to a tracking spreadsheet
- **Anti-fabrication, ATS-safe formatting, banned-word filtering** baked in via 12 user-editable markdown rule files
- **Cost:** ~$0.012 per resume with prompt caching (~$9/month at 25 applications/day)

## Quick start

See [SETUP.md](SETUP.md) — estimated 20-30 minutes for first-time setup.

## Architecture

```
Chrome Extension (MV3)          Apps Script Web App (your GAS project)
  Side Panel UI          POST     Reads source + rule files from Drive
  Content scraper    ─────────►   Calls Claude API
  chrome.storage             ◄─   Writes Google Doc + Sheet row
```

- **Chrome extension** — side panel UI, content scraper, message bus. No API key stored here.
- **Apps Script** — backend logic, Drive read/write, Claude API calls. API key lives in Script Properties.
- **12 prompt rule files** — single source of truth for generation behavior, stored in your Drive and editable there.

See [docs/superpowers/specs/2026-05-09-jobhelp-design.md](docs/superpowers/specs/2026-05-09-jobhelp-design.md) for the full design specification.

## Stack

TypeScript + esbuild + vanilla DOM + Vitest. No UI framework. No build-time secrets.

## Project structure

```
JobHelp/
├── SETUP.md                      # First-time installation guide
├── README.md                     # This file
├── prompts/shared/               # 12 rule files (load_bearing markers)
├── extension/                    # Chrome extension (MV3)
│   ├── public/                   # Built output — load this in chrome://extensions
│   ├── scripts/                  # Build scripts (esbuild)
│   └── src/
│       ├── background.ts         # Service worker + message bus
│       ├── scraper.ts            # DOM extraction per site + generic fallback
│       ├── sidepanel/            # Side panel UI (3 tabs: Generate, Files, Settings)
│       ├── lib/                  # apiClient, storage, skillsDict, onboardingState, …
│       └── types/                # Shared TypeScript contracts
├── appsscript/                   # Apps Script backend
│   └── src/                      # Code.ts, claude.ts, drive.ts, seed.ts, sheet.ts, …
├── tests/fixtures/               # HTML fixtures + sample source materials
├── claude-code/                  # Claude Code tailor-resume skill (parallel deliverable)
└── docs/                         # Specs and design
```

## Development

```bash
npm install
npm test                              # run all tests (~138 across extension + appsscript)
node extension/scripts/build.mjs      # build extension to extension/public/
```

Tests use Vitest. Node environment for pure logic tests; jsdom for UI tests. No external services needed — chrome.storage is mocked.

## Testing

```bash
npx vitest run                        # full suite
npx vitest run extension/tests/onboarding.test.ts   # onboarding state machine only
```

The test suite covers: scraper logic, Job Insights parser, Apps Script modules (Drive, Claude, doPost router, sheet logger), onboarding state machine, cost calculator, preset manager, skills dictionary, token formatter, UI smoke tests.

## Onboarding state machine

First-time users progress through these states:

```
noConfig → needsFolders → seeding → ready
```

State is computed from `chrome.storage.local` contents and displayed as a status banner in the Settings tab. The `OnboardingState` class (`extension/src/lib/onboardingState.ts`) handles state computation, `canGenerate()` gating, `requiredFields()` guidance, and `reset()`.

## Rule files

The 12 rule files in `prompts/shared/` control generation behavior. Four are load-bearing:

| File | What it controls |
|---|---|
| `02-anti-fabrication.md` | Truthfulness guarantees — never invent skills, metrics, employers |
| `06-bullet-construction.md` | Bullet format: verb + metric + context |
| `08-bridge-language.md` | How to frame transferable skills without fabrication |
| `11-self-scan-checklist.md` | ATS safety and AI fingerprint removal checklist |

Edit rule files in Drive; changes apply on the next generation. Reset to defaults from Settings.

## License

MIT
