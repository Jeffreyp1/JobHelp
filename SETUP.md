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
3. Copy the key (starts with `sk-ant-`). You'll add it to Apps Script Properties in Step 3 and to the Drive config in Step 5.

## Step 2: Set up your Google Drive folders

JobHelp needs four Google resources:

1. **Source materials folder** — where you put `.md` files describing your resume content
2. **Rule files folder** — JobHelp seeds 15 rule files here on first run; you can edit them
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
2. Build the backend bundle locally:

   ```bash
   cd /path/to/JobHelp
   node extension-app/appsscript/scripts/build.mts
   ```

   Paste the contents of `extension-app/appsscript/dist/Code.gs` into the default `Code.gs` file in Apps Script.

   > **Note:** This step is the most manual part of setup. A future release will automate deployment via `clasp push`. For now, copy-paste the generated `Code.gs`.

3. In **Project Settings** (gear icon) → **Script Properties**, add:
   - Key: `ANTHROPIC_API_KEY`
   - Value: your API key from Step 1

4. Click **Deploy** → **New deployment**
   - Type: **Web app**
   - Execute as: **Me**
   - Who has access: **Anyone with the link**

5. Click **Deploy** → authorize any permissions requested

6. Copy the **Web app URL** (ends in `/exec`). You'll add it to the Drive config in Step 5. The extension calls this URL without OAuth, so treat it as a secret capability URL.

## Step 4: Install the Chrome extension

1. Build the extension:
   ```bash
   cd /path/to/JobHelp
   npm install
   node extension-app/extension/scripts/build.mts
   ```
2. Open **chrome://extensions** in Chrome → toggle **Developer mode** (top right)
3. Click **Load unpacked** → select the `extension-app/extension/public/` folder
4. The JobHelp icon appears in your toolbar; pin it if you like

## Step 5: First-run configuration

1. Click the JobHelp icon → the side panel opens on the right
2. On a fresh install, the onboarding wizard opens automatically. If it does not, open **Settings** and start onboarding from there.
3. Create a plain-text file named `jobhelp-config.json` on your computer, using the schema in [docs/setup-for-new-users.md, Step 5](docs/setup-for-new-users.md#step-5-side-panel--onboarding-wizard).
4. Replace the placeholders with the API key, Apps Script `/exec` URL, folder IDs, tracking sheet ID, and any optional defaults from Steps 1-3, then upload the file to Google Drive. If you already have a Drive-hosted config file, use that existing file instead.
5. Copy the `jobhelp-config.json` file ID from its Drive URL or sharing link.
6. Paste that single file ID into the onboarding wizard or Settings, then click **Use this config** or **Reload config**.
7. Click **"Seed rule files"** — this calls your Apps Script backend to populate the rules folder with the 15 default rule files from GitHub. It takes 5-15 seconds.
8. The banner changes to **"Setup complete. JobHelp is ready."**

For the full click-by-click v2.1 onboarding flow, see [docs/setup-for-new-users.md](docs/setup-for-new-users.md).

## Step 6: Add your source materials

1. Open your source-materials folder in Drive (use the **"Open source folder"** button in Settings)
2. Create a new Google Doc or upload a `.md` file named `source-materials.md`
3. Use the template at `extension-app/tests/fixtures/source-materials/sample-source-materials.md` in this repo as a starting point
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

To change the default model, edit `defaults.model` in the Drive-hosted `jobhelp-config.json`, save it, then click **Reload config** in Settings.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| "Backend unreachable" | Apps Script URL wrong or deployment expired | Edit `appsScriptUrl` in `jobhelp-config.json`, click **Reload config** in Settings, and redeploy if needed |
| "Auth error" | Anthropic API key invalid or expired | Regenerate at console.anthropic.com, update `anthropicApiKey` in `jobhelp-config.json`, update Apps Script Script Properties `ANTHROPIC_API_KEY`, then reload config |
| Job Insights card stays empty | Job page selectors may have changed, or JS-heavy page | Try **Paste JD** button to paste the description manually; check Console for scrape errors |
| Generate succeeds but no Doc appears | Drive output folder ID wrong, or Apps Script lacks Drive permission | Verify folder ID; re-authorize Apps Script by running a test deployment |
| Side panel doesn't open | Chrome version too old (need 120+), or extension failed to load | Check chrome://extensions; reload the extension |
| "Seed failed" on first run | Apps Script can't reach GitHub raw URLs | Check Apps Script logs; ensure the deployment's network access is not restricted |
| Cost keeps showing $0.00 | Normal for first call before cache warms | Subsequent calls will show the cached cost |

## Editing the rules

JobHelp's generation behavior is controlled by 15 markdown rule files in your Drive `rules/` folder. Open them from **Settings → Open rule files**.

The files are plain markdown — edit them directly in Drive. Changes apply on the next generation (after the 10-minute Drive cache expires).

Six files are load-bearing and affect truthfulness guarantees:
- `02-anti-fabrication.md`
- `06-bullet-construction.md`
- `08-bridge-language.md`
- `11-self-scan-checklist.md`
- `13-output-shape.md`
- `14-revision-discipline.md`

To restore defaults after editing: **Settings → Reset rules to defaults**.

## Multi-machine setup

The Drive-hosted `jobhelp-config.json` is the source of truth. On each Chrome instance, sign into the same Google account, reinstall the extension, and paste the same Drive config file ID into the onboarding wizard or Settings. The extension then loads the core setup from Drive, so you do not re-enter the API key, Apps Script URL, folder IDs, or tracking sheet ID per machine.

During the v2.1 migration window, `chrome.storage.local` may still contain the config file ID, selected legacy mirror keys used by older background-worker paths, and Jobs-tab discovery credentials or digest/profile caches. Treat those as local cache or migration data; edit the Drive config for the core setup.

## Uninstall

Remove JobHelp from **chrome://extensions**. Your Drive folders, Apps Script project, and tracking sheet remain in your Google account — delete those manually if you want to clean up completely.
