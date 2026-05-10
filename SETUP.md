# JobHelp — Setup Guide

JobHelp is a Chrome extension that tailors your resume to job descriptions and logs applications to a Google Sheet. This guide walks you through first-time setup.

Estimated time: 20-30 minutes.

## Prerequisites

- Google account
- Chrome 120+ (or Chromium-based browser with Side Panel API support)
- Anthropic API account (free to create — costs ~$0.01-0.04 per generation, see [Cost](#costs) section)

## Step 1: Get an Anthropic API key

1. Go to [console.anthropic.com](https://console.anthropic.com) — sign up or log in
2. Navigate to **API Keys** → **Create Key**
3. Copy the key (starts with `sk-ant-`). You'll paste it in Step 5.

## Step 2: Set up your Google Drive folders

JobHelp needs four Google resources:

1. **Source materials folder** — where you put `.md` files describing your resume content
2. **Rule files folder** — JobHelp seeds 12 rule files here on first run; you can edit them
3. **Output folder** — where tailored resumes get saved as Google Docs
4. **Tracking sheet** — where each generation is logged

Create them:

1. Open [drive.google.com](https://drive.google.com) → **New** → **Folder**
   - Create three folders, e.g.: `JobHelp/source-materials`, `JobHelp/rules`, `JobHelp/outputs`
2. Open **drive.google.com** → **New** → **Google Sheets**
   - Name it `JobHelp Applications`
3. For each folder/sheet, copy the **ID** from the URL:
   - Folders: the long string after `/folders/`
   - Sheets: the long string after `/d/` and before the next `/`

> Example: `https://drive.google.com/drive/folders/1ABCxyz...` → ID is `1ABCxyz...`

## Step 3: Deploy the Apps Script backend

JobHelp uses your own Google Apps Script project as its backend. It reads/writes Drive, calls the Anthropic API, and logs to your tracking sheet — all under your Google account identity.

1. Go to [script.google.com](https://script.google.com) → **New project**. Rename to `JobHelp Backend`.
2. Copy the compiled backend code into the editor. You need one file per module. In the editor, click **+** → **Script file** to add each:
   - `Code.gs` — the HTTP router (`doPost`)
   - `claude.gs` — Claude API caller
   - `drive.gs` — Drive read/write operations
   - `sheet.gs` — tracking sheet row appender
   - `prompt.gs` — system prompt composer
   - `tokens.gs` — token estimator
   - `cost.gs` — cost tracker
   - `seed.gs` — first-run rule file seeder

   Paste the contents of each corresponding compiled file from `appsscript/src/` (after building with `node appsscript/scripts/build.mjs`).

   > **Note:** This step is the most manual part of setup. A future release will automate deployment via `clasp push`. For now, copy-paste each file.

3. In **Project Settings** (gear icon) → **Script Properties**, add:
   - Key: `ANTHROPIC_API_KEY`
   - Value: your API key from Step 1

4. Click **Deploy** → **New deployment**
   - Type: **Web app**
   - Execute as: **Me**
   - Who has access: **Only myself**

5. Click **Deploy** → authorize any permissions requested

6. Copy the **Web app URL** (ends in `/exec`). You'll paste it in Step 5.

## Step 4: Install the Chrome extension

1. Build the extension:
   ```bash
   cd /path/to/JobHelp
   npm install
   node extension/scripts/build.mjs
   ```
2. Open **chrome://extensions** in Chrome → toggle **Developer mode** (top right)
3. Click **Load unpacked** → select the `extension/public/` folder
4. The JobHelp icon appears in your toolbar; pin it if you like

## Step 5: First-run configuration

1. Click the JobHelp icon → the side panel opens on the right
2. Click the **Settings** tab
3. Paste the following values into their respective fields:
   - **Apps Script URL** — the `/exec` URL from Step 3
   - **Anthropic API key** — starts with `sk-ant-`
   - **Drive: source folder ID** — from Step 2
   - **Drive: rules folder ID** — from Step 2
   - **Drive: output folder ID** — from Step 2
   - **Tracking sheet ID** — from Step 2
4. Each field saves automatically on change (no Save button needed)
5. The status banner at the top of Settings updates as you fill fields. When all folder IDs are set, it shows "Almost ready"
6. Click **"Seed rule files"** — this calls your Apps Script backend to populate the rules folder with the 12 default rule files from GitHub. It takes 5-15 seconds.
7. The banner changes to **"Setup complete. JobHelp is ready."**

## Step 6: Add your source materials

1. Open your source-materials folder in Drive (use the **"Open source folder"** button in Settings)
2. Create a new Google Doc or upload a `.md` file named `source-materials.md`
3. Use the template at `tests/fixtures/source-materials/sample-source-materials.md` in this repo as a starting point
4. Fill in your actual work history, skills, projects, and achievements — the more detail, the better the tailoring

> **Tip:** You can split your content across multiple `.md` files (e.g., `experience.md`, `projects.md`, `skills.md`). JobHelp reads all `.md` files in the folder.

## Step 7: Generate your first resume

1. Open any job posting — LinkedIn, Indeed, Greenhouse, Lever, Workday, Ashby, or any plain HTML job page
2. Click the JobHelp icon — the side panel opens
3. The **Job Insights** card auto-fills with extracted data (title, company, salary, required skills, etc.) — no LLM used, ~50-100ms
4. Review the extracted job description in the text area; edit if needed
5. Click **Generate**
6. After 5-15 seconds, the tailored resume appears in the editor
7. Make any manual tweaks, then click **Save & Log**
8. Check your Drive output folder — there's a new Google Doc
9. Check your tracking sheet — there's a new row

## Costs

JobHelp uses your own Anthropic API key. You pay Anthropic directly; there is no JobHelp subscription.

| Model | Cost per resume | Notes |
|---|---|---|
| Haiku 4.5 (default) | ~$0.012 warm / ~$0.024 cold | Caching kicks in after first call; most subsequent calls are ~$0.012 |
| Sonnet 4.6 | ~$0.04 | Noticeably better quality |
| Opus 4.7 | ~$0.18 | Top quality; use for high-priority applications |

At 25 applications/day with Haiku 4.5, expect **~$9-12/month**.

Change the default model in Settings → **Default generate model**.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| "Backend unreachable" | Apps Script URL wrong or deployment expired | Check/re-copy the URL in Settings; redeploy if needed |
| "Auth error" | Anthropic API key invalid or expired | Regenerate at console.anthropic.com → paste new key in Settings |
| Job Insights card stays empty | Job page selectors may have changed, or JS-heavy page | Try **Paste JD** button to paste the description manually; check Console for scrape errors |
| Generate succeeds but no Doc appears | Drive output folder ID wrong, or Apps Script lacks Drive permission | Verify folder ID; re-authorize Apps Script by running a test deployment |
| Side panel doesn't open | Chrome version too old (need 120+), or extension failed to load | Check chrome://extensions; reload the extension |
| "Seed failed" on first run | Apps Script can't reach GitHub raw URLs | Check Apps Script logs; ensure the deployment's network access is not restricted |
| Cost keeps showing $0.00 | Normal for first call before cache warms | Subsequent calls will show the cached cost |

## Editing the rules

JobHelp's generation behavior is controlled by 12 markdown rule files in your Drive `rules/` folder. Open them from **Settings → Open rule files**.

The files are plain markdown — edit them directly in Drive. Changes apply on the next generation (after the 10-minute Drive cache expires).

Four files are load-bearing and affect truthfulness guarantees:
- `02-anti-fabrication.md`
- `06-bullet-construction.md`
- `08-bridge-language.md`
- `11-self-scan-checklist.md`

To restore defaults after editing: **Settings → Reset rules to defaults**.

## Multi-machine setup

Sign into your Google account on each Chrome instance and reinstall the extension. Because settings are stored locally (`chrome.storage.local`), you will need to re-enter the field values on each machine. However, all Drive content (source materials, rules, outputs, tracking sheet) is shared via your Google account — no duplication needed.

## Uninstall

Remove JobHelp from **chrome://extensions**. Your Drive folders, Apps Script project, and tracking sheet remain in your Google account — delete those manually if you want to clean up completely.
