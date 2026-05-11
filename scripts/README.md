# scripts/

Developer utilities for working on JobHelp from the command line. Each script
is a Node 18+ ESM module with **zero external dependencies** beyond what the
repo already pulls in for the extension/Apps Script builds.

| Script | Purpose |
| --- | --- |
| `test-handler.mjs` | POST a JSON request to the deployed Apps Script `/exec` URL and pretty-print the response. |
| `iterate-template.mjs` | Iteration pipeline: render a sample resume Markdown into the docxtemplater template, convert to PDF + PNG for visual review. |

---

## `test-handler.mjs`

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
node scripts/test-handler.mjs ping
node scripts/test-handler.mjs list_files \
  --folderId=1abc...XYZ --folderType=rules

# 2) Pipe JSON via stdin
echo '{"action":"ping"}' | node scripts/test-handler.mjs ping

# 3) Redirect a JSON file
node scripts/test-handler.mjs generate < req.json
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
`download_template`, `upload_filled_docx`, `research_company`, `benchmark_role`,
`critique`, `auto_revise`, `cover_letter`, `verify_cl_hooks`, `multi_version`.

Run `node scripts/test-handler.mjs --help` for the full list with examples.

### Limitations

- **No auth** — your Apps Script web app must be deployed as "Anyone with the
  link" (the standard JobHelp deployment). OAuth-protected deployments are not
  supported by this script.
- **No retries** — a single POST; failures surface immediately.
- **No streaming** — the response is buffered before printing.
- **No request-shape validation** — the script ships whatever body you give it;
  validation lives in Apps Script's `route()`.

---

## `iterate-template.mjs`

Renders a hard-coded sample resume Markdown through the docxtemplater pipeline
in `extension/src/lib/templateFiller.ts`, converts the resulting `.docx` to PDF
via `soffice`, and rasterises a preview PNG via `pdftoppm`. Useful for
iterating on the template visually.

```bash
node scripts/iterate-template.mjs
# → writes /tmp/iter-out.docx, /tmp/iter-out.pdf, /tmp/iter-out.png
```

Requires LibreOffice (`soffice`) and `poppler-utils` (`pdftoppm`) on `$PATH`.
