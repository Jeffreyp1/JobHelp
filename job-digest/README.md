# @jeffreyp1/jobhelp-mcp

A proactive job-discovery MCP server. It fetches job postings from Adzuna, Greenhouse, and Lever, runs a deterministic keyword-overlap + recency ranking pipeline, and exposes the results as MCP tools, resources, and prompts. Current supported clients are Claude Code, Claude Desktop, and Cursor using local stdio MCP. The client AI does all reasoning - ranking judgment, resume tailoring, critique, revision - in its own session using its own subscription.

## Zero-API-key principle

The server makes no LLM calls. It exposes pure data tools (HTTP fetch, regex parsing, file I/O, deterministic scoring) and prompt-context resources (rule files, resume dump, digest history). The intelligence lives in Claude or Cursor. One `npm install`, no Anthropic API key, no signup, no marginal server cost.

## Support Scope

Supported now:

- Claude Code
- Claude Desktop
- Cursor

Deferred:

- ChatGPT, because it needs a remote MCP server or secure tunnel instead of local stdio.
- Hosted multi-user use, because JobHelp currently stores data in local files under `~/jobhelp` and `~/.config/jobhelp`.

## Install

### Claude Code

```sh
claude mcp add jobhelp -- npx -y @jeffreyp1/jobhelp-mcp
```

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "jobhelp": {
      "command": "npx",
      "args": ["-y", "@jeffreyp1/jobhelp-mcp"]
    }
  }
}
```

### Cursor

Edit `.cursor/mcp.json` (project) or `~/.cursor/mcp.json` (global):

```json
{
  "mcpServers": {
    "jobhelp": {
      "command": "npx",
      "args": ["-y", "@jeffreyp1/jobhelp-mcp"]
    }
  }
}
```

## First-run setup

On first use, call `init_config` — the AI walks you through each field (Adzuna keys, Greenhouse board tokens, Lever slugs, profile location/salary/skills) and writes `~/.config/jobhelp/config.json`. Or hand-edit that file directly; either works.

Any tool call other than `init_config` returns a typed error if the config file is missing, with instructions to run `init_config`.

## Tools

| Tool | What it does |
|------|-------------|
| `init_config` | First-run setup: walks through config fields, writes `~/.config/jobhelp/config.json` |
| `apply_config_answers` | Write answers collected from `init_config` into the config file |
| `register_resume` | Store a resume under a friendly name (e.g. `backend`, `ml-engineer`); markdown only, any number of resumes |
| `set_active_resume` | Switch the active resume; with no name, lists registered resumes |
| `find_matching_jobs` | Discover jobs from all enabled sources, score against the active resume, return ranked digest |
| `get_latest_digest` | Return the most recent persisted digest without re-running discovery |
| `get_job` | Return a full `NormalizedJob` (including description) by id |
| `get_resume_outline` | Return stable section and bullet ids so clients can edit only selected resume parts |
| `apply_scoped_resume_edits` | Apply section or bullet replacements by selection id while preserving untouched lines |
| `apply_validator_resume_edits` | Apply validator-approved edits and return auditable PASS/BLOCK evidence |
| `doctor` | Run read-only setup diagnostics with actionable next steps |
| `read_rules` | Return rule files: `defaults`, `user`, or `merged` (default) |
| `read_resume` | Return the active resume content |
| `score_keyword_match` | Deterministic 0..1 keyword-overlap score between a resume and a job (ATS coverage check) |
| `start_application` | Create `~/jobhelp/applications/{company-role-date}/` if missing; idempotent |
| `write_application_output` | Write a resume, cover letter, critique, or notes artifact; auto-versions resumes and cover letters |
| `list_application_versions` | List versions of an artifact for diff or recovery |
| `list_recent_applications` | Return application history from `~/jobhelp/state.json` |
| `validate_sources` | Check configured source adapters for stale credentials, bad tokens, or rate limits |
| `rerank_top_jobs` | Bundle top jobs, active resume, and rerank instructions for client-side AI judgment |

## Prompts

| Prompt | What it does |
|--------|-------------|
| `tailor_resumes` | Orchestrates tailoring for 0..N jobs and automatically validates each draft |
| `tailor_resume` | Creates or revises one tailored resume draft from the active resume and merged rules |
| `validate_resume` | Fact-checks a tailored draft against the original resume only |

Fallback resources:

- `jobhelp://prompts/tailor-resumes`
- `jobhelp://prompts/tailor-resume`
- `jobhelp://prompts/validate-resume`

## Example session

```
User: "Use this resume from now on: ~/Documents/my-resume.md"
AI:
  1. calls register_resume({ name: "main", path: "~/Documents/my-resume.md" })
  2. calls set_active_resume({ name: "main" })

User: "Find me jobs that match it, then tailor for the top one. Emphasize my Go experience."

AI:
  1. calls find_matching_jobs({ instructions: "emphasize Go" }) → ranked digest
  2. presents top 3 to user; user picks #1
  3. requests MCP prompt tailor_resumes with the selected job id and user emphasis
  4. follows tailor_resumes:
     - start_application
     - tailor_resume
     - validate_resume
     - revise up to 3 rounds if validation blocks
  5. writes resume and critique with write_application_output
  6. returns the final output paths and PASS/BLOCK status
```

## Where state lives

All output lives under `~/jobhelp/`:

```
~/jobhelp/
  digests/         digest-YYYY-MM-DD.{md,csv,json} + latest.json
  applications/    {company-role-date}/resume.v1.md, cover-letter.v1.md, ...
  resumes/         {name}.md (registered resumes)
  state.json       registry index + application history
```

Config: `~/.config/jobhelp/config.json` (override via `JOBHELP_CONFIG` env var).
Logs: `~/.config/jobhelp/log.jsonl`.

## License

MIT. Source: https://github.com/jeffreyp1/JobHelp
