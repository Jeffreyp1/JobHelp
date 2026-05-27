# Job Digest MCP Maintainer Notes

This document describes the MCP server implementation inside `job-digest/`.
For user install snippets, example sessions, and the package-level tool table,
prefer `job-digest/README.md`; this file is for maintainers who need to change
or debug the server.

## Architecture

The published package is `@jeffreyp1/jobhelp-mcp`. It exposes a local stdio MCP
server for Claude Code, Claude Desktop, Cursor, and other clients that can run a
local command. The server does not call an LLM. It exposes deterministic job
discovery, ranking, resume, application, rule, prompt, and diagnostic surfaces,
then lets the client AI perform judgment and drafting in its own session.

At a high level:

- `job-digest/mcp/src/bin.ts` is the executable entrypoint. It loads package
  metadata, bootstraps dependencies, builds the MCP server, and connects stdio.
- `job-digest/mcp/src/index.ts` builds the MCP `Server`, registers request
  handlers for tools, resources, and prompts, and maps unknown names to typed
  errors where the MCP SDK allows it.
- `job-digest/mcp/src/wiring.ts` connects the MCP layer to core operations.
  It builds `CoreDeps` for tools and `ResourceDeps` for resources.
- `job-digest/mcp/src/wiring-cache.ts` provides lazy dependency resolution so
  a server started before first-run config exists can still serve `init_config`
  and recover after config is written.
- `job-digest/core/` owns durable behavior: source adapters, config loading,
  digest generation, ranking pipeline, resume registry, application output,
  rules, and state.

The package build compiles both MCP and the core code into `job-digest/mcp/dist/`.
Do not edit the generated `dist` files by hand.

## Major Directories And Modules

### `job-digest/mcp/src`

- `bin.ts`: CLI entrypoint for the package `bin` field.
- `index.ts`: MCP server construction and request-handler registration.
- `tools.ts`: tool composition. It combines the feature-specific tool modules
  into one MCP tool list.
- `tools-config.ts`: first-run config tools.
- `tools-resume.ts`: resume registration, active resume, active resume read,
  and keyword-overlap scoring.
- `tools-scoped-resume.ts`: outline generation and constrained resume edit
  application.
- `tools-job.ts`: job discovery, latest digest lookup, job lookup, and rule
  reads.
- `tools-batch.ts`: batch application preparation for digest jobs.
- `tools-application.ts`: application folder creation, artifact writing,
  version listing, and application history.
- `tools-meta.ts`: diagnostics, source validation, and client-side AI rerank
  bundle generation.
- `tools-parsers.ts`: boundary parsing for tool arguments.
- `tools-types.ts`: MCP-facing tool contracts.
- `tools-helpers.ts`: common tool response wrapping.
- `resources.ts`: resource descriptors and read handlers.
- `prompts.ts`: MCP prompts plus fallback prompt resources.
- `wiring*.ts`: lazy config/state binding and handler adapters.

### `job-digest/core`

- `sources/`: source adapters and source validation helpers.
- `pipeline/`: normalization, filtering, BM25, recency/source weighting, RRF,
  and ranking.
- `digest/`: digest run orchestration and Markdown/CSV formatting.
- `lib/config.ts`: config loading, environment interpolation, validation, and
  company-source merge behavior.
- `state/`: durable state schema and locked state updates.
- `resumes/`: registered-resume storage, active resume registry, outline/edit
  validators, and byte-equality checks.
- `applications/`: application folder paths, idempotent start logic, artifact
  versioning, and write locks.
- `rules/`: bundled and user rule loading plus merge behavior.
- `init/`: first-run wizard answers and config writing.

## MCP Surface

### Tools

The tool list is assembled in `mcp/src/tools.ts`. Current tools are grouped by
use case:

| Area | Tools |
| --- | --- |
| Config | `init_config`, `apply_config_answers` |
| Resume | `register_resume`, `set_active_resume`, `read_resume`, `score_keyword_match` |
| Scoped resume editing | `get_resume_outline`, `apply_scoped_resume_edits`, `apply_validator_resume_edits` |
| Jobs and rules | `find_matching_jobs`, `get_latest_digest`, `get_job`, `read_rules` |
| Applications | `start_application`, `write_application_output`, `list_application_versions`, `list_recent_applications` |
| Batch workflow | `prepare_batch_applications` |
| Diagnostics and AI handoff | `doctor`, `validate_sources`, `rerank_top_jobs` |

Tool handlers return JSON text content shaped as success or failure payloads.
Parsing failures and core errors are surfaced as MCP tool errors with typed
`error.type` values such as `invalid_input`, `not_configured`, `not_found`, and
`io_error`.

### Resources

Resources are defined in `mcp/src/resources.ts`.

| URI | MIME type | Purpose |
| --- | --- | --- |
| `jobhelp://rules/defaults` | `text/markdown` | Bundled rules only. |
| `jobhelp://rules/user` | `text/markdown` | User rule files from configured rule directory. |
| `jobhelp://rules/merged` | `text/markdown` | Effective default plus user rules. |
| `jobhelp://resume` | `text/markdown` | Active resume content. |
| `jobhelp://recent-digest` | `application/json` | Latest persisted digest. |
| `jobhelp://state` | `application/json` | Resume, digest, and application indexes. |
| `jobhelp://prompts/tailor-resumes` | `text/markdown` | Prompt fallback for batch tailoring. |
| `jobhelp://prompts/tailor-resume` | `text/markdown` | Prompt fallback for one resume draft or revision. |
| `jobhelp://prompts/validate-resume` | `text/markdown` | Prompt fallback for resume validation. |

Resource errors are returned as JSON payloads with `isError: true`.

### Prompts

Prompts are defined in `mcp/src/prompts.ts`.

- `tailor_resumes`: orchestrates 0..N jobs. It prepares applications, runs
  tailoring and validation, repeats up to three rounds when validation blocks,
  and writes artifacts.
- `tailor_resume`: creates a full draft or structured edit payload for one job.
  It uses `jobhelp://resume`, `jobhelp://rules/merged`, and the job description
  as context.
- `validate_resume`: fact-checks a tailored draft against the original resume
  only. It blocks made-up or exaggerated claims and writes a critique artifact.

The prompt fallback resources exist for clients that read resources more
reliably than MCP prompts.

## Wiring And Lazy Initialization

`bootstrap()` in `mcp/src/wiring.ts` returns lazy `coreDeps` and `resourceDeps`.
The lazy wrappers call `createDepsResolver()` from `wiring-cache.ts` on every
tool or resource access. The resolver:

1. Locates config with `JOBHELP_CONFIG_PATH` or the default user config path.
2. Tracks the config file mtime and the adjacent company-sources file mtime.
3. Reuses cached ready dependencies while both mtimes are unchanged.
4. Re-loads config and rebuilds the resume registry when either mtime changes.
5. Returns uninitialized dependencies when config is missing or invalid.

The uninitialized branch intentionally keeps only first-run setup available:
`init_config` and `apply_config_answers` still work, while other tools return
`not_configured`. Resources return `not_configured` until config is available.
This lets a long-lived MCP client start before setup and become usable after
the user writes config, without restarting the client.

## Config And State Model

Config is JSON loaded by `core/lib/config.ts`. The MCP wiring uses
`JOBHELP_CONFIG_PATH` when set; otherwise it reads the default user config path.
Config values support environment interpolation for `${NAME}` strings. The
loader validates profile, sources, ranking, output, and rules sections, then
merges adjacent company-source configuration when present.

Persistent state lives under the JobHelp home directory. `JOBHELP_HOME` can
override that root; otherwise the user home default is used. State tracks:

- registered resumes and the active resume name;
- recent applications and their application directories;
- digest index entries.

State updates use a lock file and atomic writes. Application artifact writes
also use per-application write locks. Resume and application content may be
private, so tests and docs should use synthetic temp directories and never
quote user state, real resumes, digests, or application materials.

## Run, Test, And Build

Run these from `job-digest/` unless a broader repo check is needed:

```sh
npm run test
npm run typecheck
npm run build
```

Useful focused tests while changing MCP behavior:

```sh
npx vitest run tests/mcp
npx vitest run tests/mcp/wiring.test.ts tests/mcp/wiring-lazy.test.ts
npx vitest run tests/mcp/tools.test.ts tests/mcp/resources.test.ts tests/mcp/prompts.test.ts
```

The build uses `tsc -p tsconfig.build.json`. `postbuild` marks the compiled
`mcp/dist/mcp/src/bin.js` executable. `prepublishOnly` runs the build.

## Maintenance Notes

- Keep `job-digest/README.md` as the user-facing install and usage source.
  This doc should explain internals and point to the README instead of copying
  every usage example.
- When adding a tool, update the relevant `tools-*.ts` module, parser, types,
  tests under `job-digest/tests/mcp/`, and the README tool table if user-facing
  behavior changes.
- When adding a resource, update `resources.ts` and the resource surface tests.
- When adding or changing prompts, update `prompts.ts`, prompt tests, and any
  fallback resource expectations.
- Keep tool argument parsing strict at the MCP boundary. Core modules should
  receive typed, already-normalized inputs.
- Preserve the zero-API-key server property. AI judgment belongs in the MCP
  client session, not in the local MCP server.
- Do not log, print, or document private resume, digest, application, config,
  credential, or state contents. Use temp fixtures in tests.
- If lazy initialization changes, keep the "config missing at server boot,
  config later appears" path covered by tests.
- If source adapters or ranking config change, check both digest behavior and
  `validate_sources`/`doctor` guidance.

## Troubleshooting

### Client says the server is not configured

Run `init_config`, then `apply_config_answers`, then register a resume. If a
config file already exists, check whether the MCP client process has the same
`JOBHELP_CONFIG_PATH` and `JOBHELP_HOME` environment variables as the shell.

### `doctor` reports no enabled sources

The config loaded successfully, but no source adapter is enabled. Add at least
one source in config or the adjacent company-source file, then run
`validate_sources`.

### `validate_sources` returns all failures

Check for stale API credentials, bad board tokens or slugs, network failures,
and rate limits. Validate one source at a time when isolating the issue.

### Latest digest is missing

Run `find_matching_jobs` after config, sources, and an active resume are ready.
`get_latest_digest` and `jobhelp://recent-digest` read persisted digest state;
they do not run discovery by themselves.

### Active resume is missing

Call `register_resume` with Markdown content or a path, then call
`set_active_resume` if more than one resume is registered. With no name,
`set_active_resume` lists registered resumes.

### Application output write fails

Call `start_application` or `prepare_batch_applications` before
`write_application_output`. If the application exists but writes still fail,
check the application directory permissions and stale `.write.lock` files.

### Config changes are ignored

The lazy resolver caches ready dependencies by the config and company-source
file mtimes. Save the file again, verify the MCP client sees the intended path,
or restart the client if the filesystem does not update mtimes as expected.

### Build succeeds locally but the package entrypoint fails

Run `npm run build` from `job-digest/` and verify that `mcp/dist/mcp/src/bin.js`
exists and is executable. The runtime entrypoint walks up from the compiled file
to find the package metadata, so packaging changes must preserve the expected
package structure.
