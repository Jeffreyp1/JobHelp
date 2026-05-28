# JobHelp v0.2.1 — Setup for new users

A step-by-step guide for first-time JobHelp users. v0.2.1 replaces eight separate per-machine settings with **one Drive file ID** — set it once per machine, and every JobHelp install on every machine reads the same configuration.

Estimated time: 25-40 minutes (one-time). 2-3 minutes per additional machine.

If you have already used a v0.2.0-or-earlier install, see the migration note in [Step 5](#step-5-side-panel--onboarding-wizard).

## What you'll set up

1. An Anthropic API key (paid; you pay Anthropic directly)
2. A Google Apps Script deployment (your own; runs as you)
3. Three Drive folders + one Drive config file
4. The Chrome extension (developer mode for now)

## Prerequisites

| What | Where |
|---|---|
| Google account | Any consumer or Workspace account |
| Anthropic API key | [console.anthropic.com](https://console.anthropic.com) → API Keys → Create Key |
| Chrome 120 or newer | The extension uses the Side Panel API |
| Local clone of this repo | Needed for the developer-mode install and the Apps Script bundle |

> **Security note.** Your Anthropic API key is stored in two places: `jobhelp-config.json` in *your* Drive for extension validation/display/mirroring, and Apps Script Script Properties for backend Claude calls. Treat both the config file and the Apps Script `/exec` URL as secrets. See [docs/security.md](./security.md).

## Step 1: Deploy the Apps Script backend

This step is unchanged in v0.2.1. The Apps Script project reads/writes your Drive, calls Claude, and appends rows to your tracking sheet — all under your Google identity. Follow Step 3 of the legacy guide:

- See [SETUP.md, Step 3 ("Deploy the Apps Script backend")](../SETUP.md#step-3-deploy-the-apps-script-backend) for the click-by-click flow.
- Build the bundle first: `node extension-app/appsscript/scripts/build.mts` produces `extension-app/appsscript/dist/Code.gs`.
- Paste the generated `Code.gs` into a new Apps Script project, deploy as a **Web app** (execute as **Me**, access **Anyone with the link**), and copy the resulting `/exec` URL somewhere safe — you will paste it into your config file in Step 3 below. The extension calls this URL without OAuth, so treat it as a secret capability URL.

## Step 2: Set the Anthropic API key in Apps Script Properties

Also unchanged. The Apps Script project needs its own copy of the key so the backend can call Claude.

1. In your `JobHelp Backend` script project, open **Project Settings** (the gear icon in the left rail).
2. Scroll to **Script Properties** → **Add script property**.
3. Add:
   - **Property:** `ANTHROPIC_API_KEY`
   - **Value:** your `sk-ant-…` key

Save. This is the *backend's* copy of the key; the config file you'll create in Step 3 holds the same key for the extension to use during local-only operations (cost previews, model picker, etc.).

## Step 3: Create three Drive folders

JobHelp uses three sibling folders under a single parent. Create them however you like — names are not load-bearing, only the folder IDs are.

A reasonable layout in your Drive:

```text
My Drive/
  JobHelp/
    source-materials/      <- your resume facts, achievements, projects
    rules/                 <- 15 rule .md files (auto-seeded on first run)
    output/                <- one sub-folder per generated job application
```

What goes in each:

| Folder | Holds | Created by |
|---|---|---|
| `source-materials/` | `.md` files describing your work history, skills, accomplishments. JobHelp concatenates every `.md` in this folder. Start from [`extension-app/tests/fixtures/source-materials/`](../extension-app/tests/fixtures/source-materials/) if you have none. | You |
| `rules/` | The 15 generation-rule markdown files from `extension-app/prompts/shared/`. The extension's **Seed rule files** button populates this folder on first run. | JobHelp |
| `output/` | One auto-created sub-folder per job application, each containing the generated `resume.md`, the Google Doc, and any cover letter or critique. | JobHelp |

Get each folder's ID from its Drive URL: `https://drive.google.com/drive/folders/<THIS-IS-THE-ID>`. You will paste these three IDs into the config file in [Step 5](#step-5-side-panel--onboarding-wizard).

You will also need:

- A **tracking sheet** — create a new Google Sheet in Drive; copy its ID from `https://docs.google.com/spreadsheets/d/<ID>/edit`.
- A **template DOCX** (optional) — upload your preferred resume template `.docx` to Drive; copy its file ID. Leave the field blank in the config if you do not use one.

## Step 4: Install the Chrome extension

The extension is not yet on the Chrome Web Store, so install it via developer mode.

```bash
git clone https://github.com/<your-fork>/JobHelp.git
cd JobHelp
npm install
node extension-app/extension/scripts/build.mts
```

Then:

1. Open `chrome://extensions` in Chrome.
2. Toggle **Developer mode** (top right).
3. Click **Load unpacked**.
4. Select the built directory: `extension-app/extension/public/`.
5. Pin the JobHelp icon to the toolbar (puzzle-piece menu → pin icon next to JobHelp).

## Step 5: Side panel + Onboarding wizard

This is where v0.2.1 differs from earlier versions. Instead of pasting eight values into the Settings tab, you paste **one** Drive file ID.

1. Click the JobHelp toolbar icon. The side panel opens on the right.
2. On a fresh install, the **Onboarding wizard** launches automatically.
3. In a local text editor, create a plain-text file named `jobhelp-config.json`. Do not use a Google Doc with that name; the config must be a JSON file.
4. Paste this template into the file, then replace each `<placeholder>` with the values you collected in Steps 1-3:

   ```jsonc
   {
     "anthropicApiKey": "sk-ant-<paste your key>",
     "appsScriptUrl":   "<your Apps Script /exec URL>",
     "folders": {
       "source":  "<source-materials folder id>",
       "rules":   "<rules folder id>",
       "output":  "<output folder id>"
     },
     "sheetId":        "<tracking sheet id>",
     "templateDocxId": "<template docx file id, or empty string>",
     "defaults": {
       "model":        "claude-haiku-4-5-20251001",
       "togglePreset": "Quick"
     },
     "preferences": {
       "autoConvertOnGenerate": false,
       "showCostInline":        true
     }
   }
   ```

   Field reference:

   | Field | Format | Notes |
   |---|---|---|
   | `anthropicApiKey` | `sk-ant-...` | Same key you put in Apps Script Properties in Step 2. |
   | `appsScriptUrl` | `<your Apps Script /exec URL>` | Must end in `/exec`; treat it as a secret capability URL. |
   | `folders.source` / `.rules` / `.output` | Drive folder IDs | The bare ID, not the full URL. |
   | `sheetId` | Drive file ID | From `/spreadsheets/d/<ID>/edit`. |
   | `templateDocxId` | Drive file ID or `""` | Used only by the DOCX-template filler; safe to leave blank. |
   | `defaults.model` | Anthropic model ID | One of `claude-haiku-4-5-20251001`, `claude-sonnet-4-6`, `claude-opus-4-7`. |
   | `defaults.togglePreset` | Preset name | Matches a preset in the Generate tab; `"Quick"` is the safe default. |
   | `preferences.autoConvertOnGenerate` | boolean | If true, auto-finalize to DOCX/PDF after each generate. |
   | `preferences.showCostInline` | boolean | If true, show per-call USD cost inline in the side panel. |

   The config must match the `JobhelpConfig` schema, including required non-empty strings for `anthropicApiKey`, `appsScriptUrl`, `folders.source`, `folders.rules`, `folders.output`, and `sheetId`. The loader rejects unknown types with a precise dotted-path error message (e.g. `Config field "folders.source" must be a string`).

5. Save the file, then upload it to Drive with **New** → **File upload**. If you already have a Drive-hosted `jobhelp-config.json`, use that existing file instead.
6. Copy the file's Drive ID — from the URL while the file is open, or from the file's right-click menu → **Get link**.
7. Back in the side panel, paste the file ID into the wizard's single input and click **Use this config**. If you later edit or replace the Drive file from Settings, click **Reload config**.
8. The wizard reads the file from Drive, validates the schema, and writes a success banner: **"Config loaded — JobHelp is ready."**
9. Click **Seed rule files** (offered in the wizard or under the Settings tab) to populate the rules folder with the 15 default `.md` files from this repo. Wait 5-15 seconds for the seed to finish.

After a valid Apps Script URL has already been loaded into this Chrome profile, Settings may offer **Create config** as a convenience for scaffolding a replacement config file through the backend. Fresh installs should use the manual upload or link an existing Drive file first.

You are done.

> **Coming from v0.2.0 or earlier?** On first launch after the v0.2.1 update, the migration step automatically reads your existing per-machine settings and creates a starter `jobhelp-config.json` in your Drive with them. You only need to confirm the file ID — no re-entering of folder IDs.

## Multi-machine setup

The Drive config file is the source of truth. To bring up JobHelp on a second laptop:

1. Sign in to the same Google account on Chrome.
2. Repeat **Step 4** (install the extension via developer mode).
3. When the side panel opens and the Onboarding wizard prompts you, paste the **same file ID** you used on your first machine.
4. Done. The extension reads `jobhelp-config.json` from Drive and you have the same setup.

You do **not** need to:

- Redeploy the Apps Script project (it's keyed to your Google account, not the machine).
- Recreate the Drive folders or tracking sheet.
- Re-seed the rules folder.

If you change a value (rotate the API key, switch models, etc.), edit `jobhelp-config.json` once in Drive. Other machines pick up the change on the next side-panel open, or immediately if you click **Reload config** in Settings.

## Common troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `File ID invalid` | Pasted a folder URL or extra whitespace | Use only the bare ID — the long string from `/d/<ID>` or `/folders/<ID>` |
| `Config field "<x>" must be a string` | A string field is null, missing, or a number | Edit `jobhelp-config.json` in Drive; use a non-empty string for required fields. `templateDocxId` may be `""` |
| `Config file is not valid JSON` | A stray comma, missing quote, or comment in JSON | Standard JSON does not allow `//` comments; remove them or use a JSON linter |
| `Failed to download jobhelp-config.json` | Apps Script lacks Drive permission, or the file ID is wrong | Re-authorize the Apps Script deployment; verify you copied the file's ID, not its folder's |
| `Backend unreachable` after pasting file ID | `appsScriptUrl` wrong or deployment expired | Open `jobhelp-config.json` in Drive; verify the URL ends in `/exec`; redeploy if the URL changed |
| Side panel keeps showing Onboarding wizard | File ID was saved but loader is failing silently | Open DevTools on the side panel (right-click → Inspect) and check the console; fix any validation error reported |
| Seed rule files fails | Apps Script can't reach the GitHub raw URLs | Check the Apps Script execution log; ensure the deployment has unrestricted egress |
| `Auth error` from Claude | Anthropic key invalid in `anthropicApiKey` or in Apps Script Properties | Both copies of the key must be valid. Rotate at [console.anthropic.com](https://console.anthropic.com), then update both places |
| Generated Doc never appears | `output` folder ID wrong, or Apps Script lacks Drive permission | Verify the folder ID; re-authorize the Apps Script deployment |

If the validation error mentions a field like `defaults.model`, that is the **dotted path** into your config file — open `jobhelp-config.json` and look inside the `defaults` object for the `model` key.

## Where settings live

| Setting | Lives in |
|---|---|
| Drive folder IDs, sheet ID, template ID, defaults, preferences | `jobhelp-config.json` in your Drive |
| Anthropic API key (extension's copy, for cost previews and direct calls) | `jobhelp-config.json` in your Drive |
| Anthropic API key (backend's copy, for actual Claude calls) | Apps Script Project Properties (`ANTHROPIC_API_KEY`) |
| Drive file ID of `jobhelp-config.json` | `chrome.storage.local` on each machine |
| Generated resumes / cover letters / critiques | Your Drive `output/` folder |
| Tracking-sheet rows | Your tracking Google Sheet |

The Drive config file is the source of truth for the core setup. The extension still stores the config file ID, selected legacy cache keys, and current Jobs-tab discovery/cache keys per-machine during this migration window.

## Security best practices

The default flow stores your Anthropic API key in cleartext inside the Drive config file and in Apps Script Script Properties. This is acceptable for personal use when both remain private to your Google account, but you should not share the folder containing `jobhelp-config.json` or expose the Apps Script `/exec` URL.

Passphrase encryption for the Drive config is not wired into the end-user setup today; `configCrypto.ts` is only a standalone helper. See [docs/security.md](./security.md).

Other recommendations:

- Keep `jobhelp-config.json` in **My Drive**, not a shared drive.
- Never check `jobhelp-config.json` into git.
- Rotate the Anthropic key periodically; update both the Drive config and Apps Script Script Properties at the same time.
- If you suspect the file has been exposed, revoke the Anthropic key at [console.anthropic.com](https://console.anthropic.com) immediately.

## What to do next

- Add real source materials to your `source-materials/` folder — see [README, "Add your source materials"](../README.md#add-your-source-materials).
- Read [docs/v2-features.md](./v2-features.md) to learn about the seven optional v2 pipeline toggles (Research, Benchmark, Critique, Auto-revise, Cover letter, Verify CL hooks, Multi-version).
- Generate your first tailored resume: open any job posting, click the JobHelp icon, click **Generate**.
