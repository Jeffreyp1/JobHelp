# JobHelp

Chrome extension that tailors your resume to a job description and logs each application to Google Sheets. Frontend runs in Chrome; backend runs as your own Apps Script web app calling the Anthropic API. ~$0.012 per resume (Haiku 4.5 with prompt caching).

## Install and build the extension

```bash
git clone https://github.com/<your-fork>/JobHelp.git
cd JobHelp
npm install
node extension/scripts/build.mjs
```

Then load the unpacked extension in Chrome:

```bash
# In Chrome, open:
#   chrome://extensions
# Toggle "Developer mode" (top right), click "Load unpacked",
# and select the built output directory:
open -R extension/public
```

The JobHelp icon appears in the toolbar; click it to open the side panel.

## Deploy the Apps Script backend

The backend reads/writes your Drive, calls Claude, and logs to your tracking sheet. Build the bundle, then paste each file into a new Apps Script project.

```bash
node appsscript/scripts/build.mjs
ls appsscript/dist/
# Code.gs  claude.gs  drive.gs  sheet.gs  prompt.gs  tokens.gs  cost.gs  seed.gs
```

In [script.google.com](https://script.google.com):

1. **New project** → rename to `JobHelp Backend`.
2. Add one script file per `.gs` above (click **+** → **Script file**) and paste the contents.
3. **Project Settings** → **Script Properties** → add `ANTHROPIC_API_KEY` = your `sk-ant-…` key.
4. **Deploy** → **New deployment** → type **Web app**, execute as **Me**, access **Only myself**.
5. Copy the `/exec` URL — you'll paste it into the extension's Settings tab.

## Configure the extension (first run)

Open the side panel → **Settings** tab and paste these values. Each saves on change.

| Field | Where to find it |
|---|---|
| Apps Script URL | The `/exec` URL from the deploy step above |
| Anthropic API key | [console.anthropic.com](https://console.anthropic.com) → API Keys |
| Source folder ID | Drive folder URL: `…/folders/<ID>` |
| Rules folder ID | Drive folder URL: `…/folders/<ID>` |
| Output folder ID | Drive folder URL: `…/folders/<ID>` |
| Tracking sheet ID | Sheet URL: `…/d/<ID>/edit` |

Then click **Seed rule files** in Settings — this populates the rules folder with the 12 default rule files from this repo. The status banner transitions through `noConfig → needsFolders → seeding → ready`.

For step-by-step screenshots and troubleshooting, see [SETUP.md](SETUP.md).

## Generate a tailored resume

1. Open any job posting (LinkedIn, Indeed, Greenhouse, Lever, Workday, Ashby, or generic HTML).
2. Click the JobHelp toolbar icon → side panel opens.
3. **Job Insights** auto-fills via the DOM scraper (~50–100 ms, no LLM): title, company, salary, required skills, YOE, location, visa, applicant count.
4. Review the extracted JD; edit if needed.
5. Click **Generate** → tailored resume appears in 5–15 seconds.
6. Click **Save & Log** → Doc lands in your output folder, row appears in your sheet.

## Call the backend API directly

The extension talks to Apps Script over HTTP. Every request shape is defined in [`extension/src/types/api-contract.ts`](extension/src/types/api-contract.ts) and mirrored in `appsscript/src/types/`.

Generate a resume programmatically:

```typescript
import type {
  GenerateRequest,
  GenerateResponse,
} from "./extension/src/types/api-contract.js";

const APPS_SCRIPT_URL = "https://script.google.com/macros/s/…/exec";

const request: GenerateRequest = {
  action: "generate",
  jd: "Senior backend engineer, Go, Postgres, Kafka…",
  company: "Acme",
  role: "Senior Backend Engineer",
  url: "https://acme.example.com/jobs/123",
  jobInsights: null,
  toggles: {},
  sourceFolderId: "1ABC…",
  rulesFolderId: "1DEF…",
  outputFolderId: "1GHI…",
  sheetId: "1JKL…",
  model: "claude-haiku-4-5-20251001",
};

const res = await fetch(APPS_SCRIPT_URL, {
  method: "POST",
  body: JSON.stringify(request),
});
const data = (await res.json()) as GenerateResponse;

if (!data.ok) {
  throw new Error(`${data.error.type}: ${data.error.message}`);
}
console.log(data.docUrl, data.cost.totalUsd, data.keywordCoverage.rate);
```

## Handle API errors

Every response is an `ApiResult<T>` discriminated union. Always branch on `ok` first.

```typescript
import type { ApiError, GenerateResponse } from "./extension/src/types/api-contract.js";

function describe(err: ApiError): string {
  switch (err.type) {
    case "auth":        return "API key invalid — re-paste in Settings.";
    case "rate_limit":  return "Slow down; retry in a few seconds.";
    case "drive":       return "Drive permission missing — re-authorize Apps Script.";
    case "config":      return "A folder ID or sheet ID is missing.";
    case "validation":  return `Bad request: ${err.message}`;
    case "server":      return err.retryable ? "Transient — retry." : "Server error.";
    default:            return err.message;
  }
}

const data: GenerateResponse = await callBackend();
if (!data.ok) {
  console.error(describe(data.error));
  return;
}
useResume(data.resumeMd);
```

## Switch the generation model

Change the model from the **Settings** tab → **Default generate model**, or pass `model` directly when calling the API. Approximate per-resume costs (with prompt caching warm):

```typescript
const MODELS = {
  fast:    "claude-haiku-4-5-20251001",   // ~$0.012/resume — default
  balanced:"claude-sonnet-4-6",            // ~$0.04/resume — noticeably better
  best:    "claude-opus-4-7",              // ~$0.18/resume — top quality
} as const;

await generateResume({ ...request, model: MODELS.balanced });
```

## Finalize as DOCX or PDF

After generation, the user-edited markdown is converted via Google Docs' native export:

```typescript
import type { FinalizeRequest, FinalizeResponse } from "./extension/src/types/api-contract.js";

const finalize: FinalizeRequest = {
  action: "finalize",
  docId: "1mNoP…",                  // returned by `generate`
  jobFolderId: "1qRsT…",            // returned by `generate`
  finalMarkdown: editedMarkdown,
  formats: ["docx", "pdf"],
};

const res = await fetch(APPS_SCRIPT_URL, { method: "POST", body: JSON.stringify(finalize) });
const data = (await res.json()) as FinalizeResponse;
if (data.ok) {
  for (const file of data.files) {
    console.log(file.format, file.url);
  }
}
```

## Customize the generation rules

The 12 markdown files in `prompts/shared/` are the single source of truth for generation behavior. They live in your Drive `rules/` folder after seeding — edit them there.

```bash
ls prompts/shared/
# 01-priority-hierarchy.md   05-structural-rules.md     09-section-structure.md
# 02-anti-fabrication.md     06-bullet-construction.md  10-cover-letter-industry.md
# 03-banned-words.md         07-reframing-strategies.md 11-self-scan-checklist.md
# 04-banned-phrases.md       08-bridge-language.md      12-template-reproduction.md
#                                                       13-output-shape.md
```

Four files are **load-bearing** — they enforce truthfulness and ATS safety:

```text
02-anti-fabrication.md     Never invent skills, metrics, or employers.
06-bullet-construction.md  Bullet format: verb + metric + context.
08-bridge-language.md      Frame transferable skills without fabricating.
11-self-scan-checklist.md  ATS safety + AI-fingerprint removal.
```

Edits apply on the next generation (after the 10-minute Drive cache). To restore defaults: **Settings → Reset rules to defaults**.

## Add your source materials

Place `.md` files in your source folder. JobHelp reads every `.md` in the folder and concatenates them.

```markdown
<!-- source-materials/experience.md -->
# Experience

## Senior Engineer — Acme (2022–present)
- Led migration of payments service from monolith to 3 Go microservices,
  reducing p95 latency from 480ms to 120ms.
- Designed Kafka-based event bus handling 12k events/sec at peak.

# Skills
- Go, TypeScript, Python
- Postgres, Kafka, Redis
- AWS (ECS, RDS, SQS)
```

A starter template lives at [`tests/fixtures/source-materials/sample-source-materials.md`](tests/fixtures/source-materials).

## Add support for a new job site

Scrapers live in `extension/src/scraper.ts`. Each is a function that takes the page DOM and returns a partial `ScraperOutput`. Register it in the dispatcher.

```typescript
import type { ScraperOutput } from "./types/scraper-output.js";

export function scrapeMyAts(doc: Document): Partial<ScraperOutput> {
  return {
    title:   doc.querySelector("h1.job-title")?.textContent?.trim() ?? null,
    company: doc.querySelector(".company-name")?.textContent?.trim() ?? null,
    jdHtml:  doc.querySelector(".job-description")?.innerHTML ?? "",
    location: doc.querySelector(".location")?.textContent?.trim() ?? null,
  };
}

// In dispatchScraper():
if (location.hostname.endsWith("myats.example.com")) {
  return scrapeMyAts(document);
}
```

Add a fixture at `tests/fixtures/<site>.html` and a test that pins the expected output.

## Run the tests

```bash
npm test                                              # full suite (~138 tests, ~3s)
npx vitest run extension/tests/onboarding.test.ts     # one file
npx vitest run -t "scraper"                           # by name
npx vitest                                            # watch mode
```

Tests use Vitest. Pure logic runs in Node; UI tests run under jsdom. `chrome.storage` is mocked — no Chrome or external services needed.

## Costs

You pay Anthropic directly with your own API key. There is no JobHelp subscription.

```text
Haiku 4.5 (default)   ~$0.012 warm / ~$0.024 cold   default
Sonnet 4.6            ~$0.04                         noticeably better quality
Opus 4.7              ~$0.18                         top quality
```

At 25 applications/day on Haiku 4.5 with prompt caching: **~$9–12/month**.
