# Claude To Codex Map

Use this file when you forget which surface belongs to Claude, which belongs to Codex, and how a workflow carries over.

| Area | Claude | Codex | Notes |
|---|---|---|---|
| Main working agreement | `CLAUDE.md` | `AGENTS.md` | Keep both. Claude reads the first naturally; Codex reads the second naturally. |
| Agent directory | `.claude/agents/*.md` | `.codex/agents/*.toml` | Same roles, different file format. |
| Karen code review | `.claude/agents/karen-code-review.md` | `.codex/agents/karen-code-review.toml` | Filename says `karen-code-review`; agent name is `karen` in both systems. |
| Karen auditor | `.claude/agents/karen-the-auditor.md` | `.codex/agents/karen-the-auditor.toml` | Read-only codebase audit role. |
| Karen fixer | `.claude/agents/karen-the-fixer.md` | `.codex/agents/karen-the-fixer.toml` | One scoped simplification/fix role. |
| Karen manager | `.claude/agents/karen-the-manager.md` | `.codex/agents/karen-the-manager.toml` | Completion verification role. Codex copy references `AGENTS.md`. |
| Resume tailor | `.claude/agents/resume-tailor.md` | `.codex/agents/resume-tailor.toml` | Client-AI agent used with the MCP. Creates the tailored resume; not an MCP tool. |
| Resume validator | `.claude/agents/resume-validator.md` | `.codex/agents/resume-validator.toml` | Client-AI agent used with the MCP. Checks the tailor's work; not an MCP tool. |
| Resume command | `.claude/commands/tailor-batch.md` | MCP prompt `tailor_resumes` plus `.agents/skills/source-command-tailor-batch/SKILL.md` | MCP prompt is the portable source of truth; local skill is a wrapper. |
| Resume trigger skill | `.claude/skills/tailoring-resumes/SKILL.md` | `.agents/skills/tailoring-resumes/SKILL.md` | Trigger phrase skill. Codex should route to MCP prompt `tailor_resumes`. |
| Claude settings | `.claude/settings.local.json` | `.codex/config.toml` | Different formats. Do not assume settings transfer automatically. |
| Worktrees | `.claude/worktrees/*` | no required equivalent | Codex can work in the current repo or a normal git worktree. |
| MCP server | Claude MCP settings | `.codex/config.toml` | Verify the configured MCP command/path before using JobHelp MCP tools. |

## Agent Parity

All six Claude agents currently have Codex counterparts:

| Role | Agent name |
|---|---|
| Final diff review | `karen` |
| Codebase audit | `karen-the-auditor` |
| Scoped fixer | `karen-the-fixer` |
| Completion verifier | `karen-the-manager` |
| Resume draft/edit agent | `resume-tailor` |
| Resume fact-check agent | `resume-validator` |

The main format difference is metadata. Claude agent files include frontmatter such as `tools:` and sometimes `model: opus`. Codex agent files store the prompt body in TOML `developer_instructions`; tool and write-scope discipline must be enforced by the orchestrating Codex session.

The Karen agents are primarily for your development workflow. The resume prompts are primarily for Claude/Cursor local MCP automation around the JobHelp MCP: the client AI invokes `tailor_resumes`, which runs `tailor_resume` and `validate_resume`, while the MCP provides the user's own resume, rules, tasks, job context, and write targets.

## Tool Name Translation

Some migrated agent instructions still mention Claude tool names. Treat them as concepts:

| Claude wording | Codex equivalent |
|---|---|
| `Read` | inspect files with shell reads or available file tools |
| `Grep` / `Glob` | `rg`, `rg --files`, or equivalent shell search |
| `Bash` | shell command execution |
| `Edit` / `Write` | `apply_patch` or other approved file-edit tool |
| `Task` / `Agent tool` | Codex subagents when explicitly requested |
| `subagent_type` | Codex `agent_type` |
| `WebFetch` | browser/web tooling when available and appropriate |

## Resume Prompts With MCP

Claude flow:

1. `tailoring-resumes` skill triggers.
2. `/tailor-batch` command parses latest digest, job IDs, or URLs.
3. `resume-tailor` writes a draft or edit JSON.
4. `resume-validator` fact-checks without seeing the JD.
5. The orchestrator loops for up to three rounds.

Codex/local-MCP flow:

1. `.agents/skills/tailoring-resumes/SKILL.md` triggers on the same user intent in local Codex sessions.
2. Claude or Cursor can request MCP prompt `tailor_resumes`.
3. `tailor_resumes` tells the client AI to run `tailor_resume` for each job using MCP-provided resume/rules/job context.
4. `tailor_resumes` tells the client AI to run `validate_resume` automatically after every draft.
5. The orchestrator applies validator-driven edits mechanically until PASS or the round limit.

The flow depends on the JobHelp MCP server being configured and available. `tailor_resumes`, `tailor_resume`, and `validate_resume` are MCP prompts and prompt fallback resources, not MCP tools. ChatGPT support is deferred because it needs remote MCP or a secure tunnel.
