# JobHelp Chrome Extension Internals

The extension is the browser front end for JobHelp. It runs as a Chrome Manifest V3 extension with a side panel UI, an MV3 background service worker, and an injected scraper bundle. The backend remains the Apps Script web app; the extension sends typed action requests to that backend and renders the returned files, costs, edits, and diagnostics.

For the end-to-end extension app product guide, including Apps Script and Drive setup, start with [`../README.md`](../README.md).

## Architecture

The build produces three browser bundles under `extension-app/extension/public/`:

| Bundle | Source entry | Purpose |
|---|---|---|
| `background.js` | `extension-app/extension/src/background.ts` | MV3 service worker. Opens the side panel, watches tab changes and page-load completion, injects the scraper, routes selected panel messages, and calls the backend for background-owned actions. |
| `sidepanel/index.js` | `extension-app/extension/src/sidepanel/index.ts` | Main UI bundle. Renders Generate, Files, Jobs, and Settings tabs; owns runtime config hydration; calls the backend directly for most side-panel workflows. |
| `scraper.bundle.js` | `extension-app/extension/scripts/_scraper-shim.ts` generated from `extension-app/extension/src/scraper.ts` and `scraper-*` helpers | Injected into the active tab by the background worker. Exposes `window.__jobhelpScrape()` and returns a structured scrape result. |

`extension-app/extension/public/manifest.json` declares the MV3 extension, side panel, background worker, permissions, and icons. `extension-app/extension/scripts/build.mts` copies static side-panel assets, ensures placeholder icons exist when needed, writes the scraper shim, and bundles the three entries with esbuild.

## Major Directories

| Path | Contents |
|---|---|
| `extension-app/extension/src/background.ts` | Service-worker event wiring, scrape injection, generate request routing, settings persistence bridge, and selected async side-panel responses. |
| `extension-app/extension/src/scraper.ts` and `scraper-*.ts` | Pure DOM scraper for LinkedIn, Indeed, Greenhouse, Lever, Workday, Ashby, and generic job pages. The entry file selects strategy; sibling modules own site extraction, field parsing, job insights, and DOM helpers. |
| `extension-app/extension/src/sidepanel/` | Side panel entry point, tabs, UI components, feature renderers, onboarding wizard, HTML, and CSS. |
| `extension-app/extension/src/sidepanel/tabs/` | Generate, Files, Jobs, and Settings tab implementations. |
| `extension-app/extension/src/sidepanel/features/` | Optional pipeline feature UI and rendering code for research, benchmark, critique, auto-revise, cover letter, hook verification, and multi-version generation. |
| `extension-app/extension/src/sidepanel/components/` | Shared UI components such as the resume editor, cost estimator, job insights card, toggle row, and revise composer. |
| `extension-app/extension/src/lib/` | Browser-side utilities: API client, config loader/migration, storage wrapper, template filling, DOCX helpers, cost calculation, logging, presets, and cached job digest support. Larger utilities are split into cohesive `*-*.ts` helpers. |
| `extension-app/extension/src/types/` | Extension-owned TypeScript contracts for backend actions, Chrome message bus payloads, config, storage, scraping, and job discovery. |
| `extension-app/extension/tests/` | Local-only Vitest coverage for background behavior, scraper behavior, lib utilities, side-panel UI, settings, onboarding, and v2 workflows when present in this workspace. Publication-tracked extension tests live under `extension-app/tests/`. |
| `extension-app/tests/` | Publication-tracked cross-package fixtures, contract tests, and focused side-panel safety tests. |
| `extension-app/extension/public/` | Built extension output loaded by Chrome. Do not edit generated JS bundles by hand. |

## Runtime Flow

1. Chrome loads `extension-app/extension/public/manifest.json`.
2. Clicking the toolbar action opens the side panel.
3. The background service worker listens for active-tab changes and completed page loads.
4. For scrapeable pages, the background worker injects `scraper.bundle.js`, calls `window.__jobhelpScrape()`, and sends a `scrape_result` message to the side panel.
5. The Generate tab applies the scrape result to company, role, URL, job description, and job insight fields. The user can edit these before running the pipeline.
6. The Generate tab sends the base `generate` action through the background worker. The background worker reads the mirrored Apps Script URL from storage, calls `ApiClient.generate()`, and sends `generate_result` back to the side panel.
7. Post-generation actions such as save, finalize, template conversion, critique, auto-revise, cover letter, and multi-version calls are wired from the side panel through `ApiClient`.
8. The backend writes Drive outputs and updates the tracking sheet. The side panel displays returned URLs, costs, markdown, diffs, and status messages.

The scraper is intentionally non-LLM. It uses DOM selectors, JSON-LD, metadata fallbacks, regular expressions, and the bundled skills dictionary to produce `ScraperOutput`.

## Side Panel

The side panel renders four tabs:

| Tab | Responsibilities |
|---|---|
| Generate | Primary tailoring workflow: scrape intake, metadata edits, job description textarea, model and feature toggles, cost estimate, generate button, resume editor, save, finalize, and template conversion. |
| Files | Lists source and rules files from Drive through the backend. |
| Jobs | Optional job discovery and ranking workflow. It can extract a profile from source materials, run a digest for the extension-supported sources, cache the latest digest locally, prefill Generate from a ranked job, and update tracking status. This is narrower than the MCP source-adapter catalog. |
| Settings | Links a Drive-hosted config file, reloads config, opens config in Drive, runs onboarding, migrates legacy local settings when available, and shows a redacted diagnostic readout. |

`extension-app/extension/src/sidepanel/index.ts` owns tab construction, navigation, runtime config adoption, and the hooks passed into each tab.

## Background Worker

`extension-app/extension/src/background.ts` owns browser event handling:

- Opens the side panel when the extension action is clicked.
- Scrapes the active tab on tab activation and page-load completion.
- Skips unsupported browser URLs such as `chrome://`, extension pages, `about:`, and local files.
- Persists the latest successful job insights so the side panel can recover useful context after reopening.
- Routes `generate_request`, `rescan_request`, `settings_update`, `list_files_request`, and `seed_defaults_request`.
- Uses structured logging for non-benign failures and treats "side panel closed" message failures as expected.

## Scraper

`extension-app/extension/src/scraper.ts` chooses a scrape strategy by hostname and page structure, then delegates to focused scraper helper modules. Supported first-class strategies are:

- LinkedIn
- Indeed
- Greenhouse
- Lever
- Workday
- Ashby
- Generic HTML fallback

The scraper returns `ScraperOutput`, including raw job description text, company, role, URL, strategy, scrape timestamp, and optional `JobInsights`. It does not call the backend or any model.

## Config Model

The v2.1 setup model uses a single Drive-hosted `jobhelp-config.json` file as the source of truth. The extension stores the config file ID in `chrome.storage.local` under `jobhelpConfigFileId`, mirrors selected legacy config keys for background-worker paths that still read them, and stores current Jobs-tab discovery/cache keys locally.

The loaded config includes:

- Anthropic API key
- Apps Script `/exec` URL
- Source, rules, and output Drive folder IDs
- Tracking sheet ID
- Optional template DOCX file ID
- Default model and toggle preset
- UI preferences

The side panel loads and validates this config through `extension-app/extension/src/lib/configLoader.ts`, caches it in memory for the session, and mirrors selected values into legacy storage keys. That mirror is intentional during the migration window because parts of the background worker still read the legacy keys. Jobs-tab source credentials and cached digest/profile state are also local today; they are not part of the Drive config yet.

Do not print config contents in logs or docs. The Settings diagnostic masks the API key and never needs secret values in source control.

## Backend Contracts

The extension/backend wire contract lives in `extension-app/extension/src/types/api-contract.ts`. This file is the source of truth and is mirrored manually to `extension-app/appsscript/src/types/api-contract.ts`.

Important contract rules:

- Every backend request has an `action` string.
- Every backend response is an `ApiResult<T>` discriminated union.
- Callers must branch on `ok` before reading success fields.
- `ApiError.type` is one of `auth`, `rate_limit`, `server`, `validation`, `drive`, `config`, or `other`.
- If the contract changes, update the Apps Script mirror at the same time.

Chrome runtime messages are typed in `extension-app/extension/src/types/message-bus.ts`. Local storage keys are typed in `extension-app/extension/src/types/storage-schema.ts`.

## Build, Test, And Type Check

Run commands from the repo root.

```bash
npm install
npx vitest run
npx tsc --noEmit
node extension-app/extension/scripts/build.mts
node extension-app/appsscript/scripts/build.mts
node scripts/verify-bundle.mts
```

Focused extension commands:

```bash
npx vitest run extension-app/tests/sidepanel/resumeEditor-selection.test.ts
npx vitest run extension-app/tests/contracts/verify-bundle-actions.test.ts
node extension-app/extension/scripts/build.mts
node extension-app/extension/scripts/build.mts --watch
```

`node scripts/verify-bundle.mts` builds both extension and Apps Script bundles and checks bundle size, manifest shape, version consistency, and backend action coverage.

## Load Locally In Chrome

1. From the repo root, build the extension:

   ```bash
   node extension-app/extension/scripts/build.mts
   ```

2. Open `chrome://extensions`.
3. Enable Developer mode.
4. Click Load unpacked.
5. Select `extension-app/extension/public`.
6. Pin or click JobHelp in the toolbar to open the side panel.
7. In Settings, run onboarding or paste the Drive file ID for `jobhelp-config.json`, then click Reload config.
8. Open a job posting and let the side panel populate from the scraper. Review and edit the inputs before generating.

After source changes, rebuild and click the extension reload button in `chrome://extensions`. For background-worker changes, inspect service-worker logs from the extension card.

## Important Dependencies

The extension uses the root package dependencies. Notable browser-side dependencies include:

- `esbuild` for bundling the MV3 worker, side panel, and scraper.
- `@types/chrome` for Chrome extension APIs.
- `marked` for markdown rendering in the side panel.
- `docxtemplater`, `pizzip`, and `docx` for client-side DOCX/template handling.
- `jsdom` and `vitest` for tests.

Avoid adding production dependencies unless the existing browser APIs or repo utilities cannot reasonably do the job.

## Development Notes

- Keep `extension-app/extension/public/` treated as generated output except for static manifest and icon assets.
- The side panel imports `getRuntimeConfig()` from `sidepanel/index.ts`; that circular shape is intentional and safe because callers use it inside event handlers.
- Apps Script runs synchronously, but extension code can use browser async APIs.
- Use `extension-app/extension/src/lib/structuredLog.ts` for extension logging.
- Use `extension-app/extension/src/lib/storage.ts` rather than raw `chrome.storage.local` when a key is in `StorageSchema`.
- Keep `extension-app/extension/src/types/api-contract.ts` and `extension-app/appsscript/src/types/api-contract.ts` synchronized when changing the wire shape.
- The scraper bundle must keep working inside arbitrary job pages, so avoid Node APIs or page-global assumptions there.

## Troubleshooting

| Symptom | Likely cause | What to check |
|---|---|---|
| Side panel opens but Settings says config is missing | `jobhelpConfigFileId` is not set or the Drive file cannot be loaded | Paste the config file ID, click Reload config, and check that the Apps Script URL inside the config is valid. |
| Generate returns a config error | Apps Script URL was not loaded or mirrored yet | Reload config in Settings, then retry. If the side panel was already open during setup, close and reopen it. |
| Scraper does not populate the job description | Unsupported page, restricted browser URL, page structure changed, or injection failed | Click rescan if available, inspect the background service-worker logs, or paste the job description manually. |
| Backend response says it is not valid JSON | Wrong Apps Script URL, auth landing page, or deployed web app is returning HTML | Verify the `/exec` URL and backend deployment access. |
| Files tab is empty | Missing source/rules folder IDs or backend Drive permission issue | Reload config and verify the backend can access the configured folders. |
| Template conversion fails | Missing template DOCX ID, unsupported template content, or Drive upload error | Confirm `templateDocxId` in the config and try finalize-to-DOCX/PDF as a control path. |
| Changes are not visible in Chrome | Extension was not rebuilt or reloaded | Run `node extension-app/extension/scripts/build.mts`, then reload the unpacked extension in `chrome://extensions`. |

## Manual Smoke Path

After a build, a basic local smoke check is:

1. Load `extension-app/extension/public` as an unpacked extension.
2. Open Settings and load a valid config.
3. Open a supported job posting.
4. Confirm company, role, URL, job description, and job insights populate.
5. Generate a resume.
6. Edit the returned markdown and save.
7. Finalize to DOCX or PDF.
8. Confirm the output folder and tracking sheet were updated by the backend.

For broader manual UI coverage, use `extension-app/extension/tests/sidepanel/MANUAL-TEST-CHECKLIST.md` when the local-only extension test suite is present.
