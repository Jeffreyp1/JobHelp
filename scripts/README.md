# scripts/

Developer utilities for working on JobHelp from the command line. Each script
is a Node 18+ ESM module with **zero external dependencies** beyond what the
repo already pulls in for the extension and Apps Script builds.

| Script | Purpose |
| --- | --- |
| `test-handler.mts` | POST a JSON request to the deployed Apps Script `/exec` URL and pretty-print the response. |
| `iterate-template.mts` | Iteration pipeline: render a sample resume Markdown into the docxtemplater template, convert to PDF + PNG for visual review. |

---

## `test-handler.mts`

Exercises any Apps Script handler from the terminal — no need to roundtrip
through the Chrome extension. Useful for debugging routes, validating request
shapes, and smoke-testing a fresh deployment.

### Setup

The script needs the `/exec` URL of your deployed Apps Script web app. Provide
it via environment variable **or** a `.env` file at the repo root.

```bash
# Option A: shell env
export APPS_SCRIPT_URL=https://script.google.com/macros/s/AKfycb.../exec

# Option B: .env in repo root (parsed manually — no dotenv dep)
echo 'APPS_SCRIPT_URL=https://script.google.com/macros/s/AKfycb.../exec' > .env
```

The env var wins if both are set.

### Usage

Three ways to supply the request body:

```bash
# 1) Build body from --field=value flags
node scripts/test-handler.mts ping
node scripts/test-handler.mts list_files \
  --folderId=1abc...XYZ --folderType=rules

# 2) Pipe JSON via stdin
echo '{"action":"ping"}' | node scripts/test-handler.mts ping

# 3) Redirect a JSON file
node scripts/test-handler.mts generate < req.json
```

When all three are mixed, the merge order is: stdin JSON object first, then
`--flag` overrides on top, and finally the action from `argv[0]` overwrites any
`action` value to keep them consistent.

### Flag value parsing

`--field=value` values are decoded as JSON when possible. Examples:

```bash
--count=3                # number 3
--forceRefresh=true      # boolean true
--framings='["Tech","Lead"]'  # array
--toggles='{"research":{"enabled":true}}'  # nested object
--company="Acme Corp"    # plain string
```

### Output

For every call the script prints:

1. Request line: target URL, action, request size.
2. Response line: HTTP status, response size, elapsed time.
3. Pretty-printed JSON body (colourised when stdout is a TTY; respects `NO_COLOR`).
4. Status footer: green `ok=true` or red `ok=false (<type>)`.

Exit code is `0` when `ok=true` in the response body, `1` otherwise (including
network errors, non-JSON responses, and missing `APPS_SCRIPT_URL`).

### Supported actions

`ping`, `generate`, `finalize`, `list_files`, `write_file`, `seed_defaults`,
`download_template`, `upload_filled_docx`, `create_drive_file`,
`research_company`, `benchmark_role`, `critique`, `auto_revise`,
`auto_revise_scoped`, `cover_letter`, `verify_cl_hooks`, `multi_version`,
`extract_profile`, `discover_and_rank`, `update_job_status`.

Run `node scripts/test-handler.mts --help` for the full list with examples.

### Limitations

- **No auth** — your Apps Script web app must be deployed as "Anyone with the
  link" (the standard JobHelp deployment). OAuth-protected deployments are not
  supported by this script.
- **No retries** — a single POST; failures surface immediately.
- **No streaming** — the response is buffered before printing.
- **No request-shape validation** — the script ships whatever body you give it;
  validation lives in Apps Script's `route()`.

---

## `iterate-template.mts`

Renders a hard-coded sample resume Markdown through the docxtemplater pipeline
in `extension-app/extension/src/lib/templateFiller.ts`, converts the resulting `.docx` to PDF
via `soffice`, and rasterises a preview PNG via `pdftoppm`. Useful for
iterating on the template visually.

```bash
node scripts/iterate-template.mts
# → writes /tmp/iter-out.docx, /tmp/iter-out.pdf, /tmp/iter-out.png
```

Requires LibreOffice (`soffice`) and `poppler-utils` (`pdftoppm`) on `$PATH`.

---

## `verify-bundle.mts`

Post-build state verifier. Runs both build pipelines and asserts the produced
artifacts are well-formed before you ship them: present, non-empty, within size
budgets, contain the expected entry points and constants, and that
`manifest.json`'s version matches the latest `CHANGELOG.md` entry.

```bash
node scripts/verify-bundle.mts
node scripts/verify-bundle.mts --no-build   # skip the build step
```

### What it checks

**Extension** (`extension-app/extension/public/`):

- `sidepanel/index.js` exists, non-empty, under **2 MB**
- `background.js` exists, non-empty, under **500 KB**
- `scraper.bundle.js` exists, non-empty
- `sidepanel/style.css` exists, non-empty
- `manifest.json` is valid JSON, `manifest_version === 3`, and `version`
  matches the latest `## [x.y.z]` heading in `CHANGELOG.md`. **This is the
  catch for "I bumped the changelog but forgot the manifest" (or vice versa).**

**Apps Script** (`extension-app/appsscript/dist/Code.gs`):

- File exists, non-empty, under **200 KB**
- First non-comment token is valid Apps Script JS (no leftover `import type`,
  `interface`, or top-level `export` keyword)
- Contains the literal `function doPost` (web-app entry point)
- Contains every action in the verifier's `VALID_ACTIONS` mirror of
  `Code.ts`, including `create_drive_file`, `extract_profile`,
  `discover_and_rank`, and `update_job_status`

Exit code is `0` on all-pass, `1` on any failure. Each check prints its
wallclock duration; output respects `NO_COLOR`.

---

## `smoke-test.mts`

Pre-commit / CI smoke harness. Chains `verify-bundle.mts` with an optional
deployed-endpoint ping.

```bash
# Local: verifies bundles only.
node scripts/smoke-test.mts

# With a deployed URL: also pings /exec and asserts response shape.
APPS_SCRIPT_URL=https://script.google.com/macros/s/.../exec \
  node scripts/smoke-test.mts
```

### Phases

1. **verify-bundle** — full bundle verification (above).
2. **apps-script ping** — only when `APPS_SCRIPT_URL` is set (env var or
   `.env`). Spawns `scripts/test-handler.mts ping`, captures stdout, and
   asserts the response body has `ok: true`, `version: <string>`, and
   `serverTime: <string>`. When unset, the phase is explicitly skipped with a
   clear message — exit code stays `0`.

A summary block at the end prints per-phase elapsed time and total wallclock.
Designed to run in CI (where `APPS_SCRIPT_URL` is typically absent) or
locally as a pre-commit check.

When the local-only smoke suite is present, `extension-app/tests/smoke/smoke.test.ts`
runs both scripts via `child_process.spawnSync` and asserts exit code `0`.
