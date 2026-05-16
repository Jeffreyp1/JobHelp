# @jeffreyp1/jobhelp-mcp

A proactive job-discovery MCP server. It fetches job postings from Adzuna, Greenhouse, and Lever, runs a deterministic keyword-overlap + recency ranking pipeline, and exposes the results as MCP tools and resources. The client AI (Claude Code, Claude Desktop, Cursor, Zed, Codex, Continue) does all reasoning — ranking judgment, resume tailoring, critique, revision — in its own session using its own subscription.

## Zero-API-key principle

The server makes no LLM calls. It exposes pure data tools (HTTP fetch, regex parsing, file I/O, deterministic scoring) and prompt-context resources (rule files, resume dump, digest history). The intelligence lives in whatever MCP client the user already has. One `npm install`, no Anthropic API key, no signup, no marginal server cost.

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

### Zed

In your Zed `settings.json`:

```json
{
  "assistant": {
    "mcp_servers": {
      "jobhelp": {
        "command": "npx",
        "args": ["-y", "@jeffreyp1/jobhelp-mcp"]
      }
    }
  }
}
```

### Codex / VS Code Continue / Aider

Follow your client's MCP server configuration format, using:

- **command:** `npx`
- **args:** `["-y", "@jeffreyp1/jobhelp-mcp"]`

## First-run setup

On first use, call `init_config` — the AI walks you through each field (Adzuna keys, Greenhouse board tokens, Lever slugs, profile location/salary/skills) and writes `~/.config/jobhelp/config.json`. Or hand-edit that file directly; either works.

Any tool call other than `init_config` returns a typed error if the config file is missing, with instructions to run `init_config`.

## Tools

| Tool | What it does |
|------|-------------|
| `init_config` | First-run setup: walks through config fields, writes `~/.config/jobhelp/config.json` |
| `register_resume` | Store a resume under a friendly name (e.g. `backend`, `ml-engineer`); markdown only, any number of resumes |
| `set_active_resume` | Switch the active resume; with no name, lists registered resumes |
| `find_matching_jobs` | Discover jobs from all enabled sources, score against the active resume, return ranked digest |
| `get_latest_digest` | Return the most recent persisted digest without re-running discovery |
| `get_job` | Return a full `NormalizedJob` (including description) by id |
| `read_rules` | Return rule files: `defaults`, `user`, or `merged` (default) |
| `read_resume` | Return the active resume content |
| `score_keyword_match` | Deterministic 0..1 keyword-overlap score between a resume and a job (ATS coverage check) |
| `start_application` | Create `~/jobhelp/applications/{company-role-date}/` if missing; idempotent |
| `write_application_output` | Write a resume, cover letter, critique, or notes artifact; auto-versions resumes and cover letters |
| `list_application_versions` | List versions of an artifact for diff or recovery |
| `list_recent_applications` | Return application history from `~/jobhelp/state.json` |

## Example session

```
User: "Use this resume from now on: ~/Documents/my-resume.md"
AI:   calls set_active_resume({ path: "~/Documents/my-resume.md" })

User: "Find me jobs that match it, then tailor for the top one. Emphasize my Go experience."

AI:
  1. calls find_matching_jobs({ instructions: "emphasize Go" }) → ranked digest
  2. presents top 3 to user; user picks #1
  3. calls get_job("greenhouse:doordash:abc123") → full JD
  4. loads jobhelp://rules/merged and jobhelp://resume into its prompt context
  5. generates tailored resume markdown in its own session using rules + instructions
  6. calls score_keyword_match(generated_resume, job_id) → 0.84
  7. critiques own draft against the rule-file 8-dimension rubric
  8. revises bullets the critique flagged → final markdown
  9. calls start_application(job_id) → ~/jobhelp/applications/doordash-swe-i-2026-05-15/
  10. calls write_application_output({ jobId, kind: "resume", content }) → resume.v1.md
  11. optionally generates cover letter + verify-hooks, writes those too
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
