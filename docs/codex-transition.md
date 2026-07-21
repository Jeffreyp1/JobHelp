# Codex Transition Guide

This repo now keeps Claude and Codex support side by side. The goal is not to rename the project, rewrite the agents, or replace Anthropic model names in the app. The goal is to make your existing Claude workflow easy to run from Codex, and to preserve the resume workflow for local MCP clients. User-facing MCP support is scoped to Claude and Cursor for now.

## Before And After

Before, the working memory lived mostly in Claude-specific files:

- `CLAUDE.md` told Claude how to work in this repo.
- `.claude/agents/*.md` held the Karen army and resume agents.
- `.claude/commands/tailor-batch.md` owned the resume tailoring loop.
- `.claude/skills/*` triggered Claude workflows.
- `.claude/worktrees/*` held Claude-created worktrees.

After, Codex gets its own bridge layer:

- `AGENTS.md` is the Codex-facing working agreement.
- `.codex/agents/*.toml` holds Codex-native versions of the same named agents.
- `.agents/skills/*` holds migrated skills and command bodies.
- `.codex/config.toml` configures Codex-local MCP servers.
- This guide and `docs/codex-claude-map.md` explain which side owns what.

Keep both systems. `CLAUDE.md` remains useful for Claude sessions. `AGENTS.md` is the file future Codex sessions should treat as the local working agreement.

## How To Ask Codex For The Old Workflows

For development workflows, use plain requests that name the Karen workflow you want:

- "Use karen-the-auditor on `extension-app/extension/src/sidepanel/tabs/generate.ts`."
- "Use karen-the-fixer for the audit finding in this function."
- "Use karen on this diff before I push."
- "Use karen-the-manager to verify this task is actually complete."
- "Run the migrated tailor-batch flow for the latest digest."

The resume workflow is different. `tailor_resumes`, `tailor_resume`, and `validate_resume` are MCP prompts, not MCP tools. They are instructions for Claude/Cursor-style local MCP clients: when a user needs resumes created, `tailor_resumes` iterates 0..N jobs, `tailor_resume` creates each draft, and `validate_resume` checks the work automatically. The JobHelp MCP supplies the resume, rules, job, and application-output primitives those prompts use.

When parallel agents are involved, Codex should act as the orchestrator. Agents should get narrow, non-overlapping scopes. Read-only audits should stay read-only. If an agent needs a change outside its scope, it should report `CROSS-IMPACT:` instead of editing.

## What Not To Rename

Do not replace app-level Claude model names with Codex names. In this repo, strings like `claude-haiku-4-5-20251001`, `claude-sonnet-4-6`, and `ClaudeApiError` refer to Anthropic backend behavior, not Claude Code as an editor.

Do not rewrite `.claude/worktrees/*` into Codex assets. Treat them as historical or active Claude worktrees. Codex can inspect them when useful, but migration docs should not point new configuration at those worktree paths.

## Known Transition Notes

- `.codex/config.toml` currently uses a personal absolute MCP path. Verify it before relying on MCP tools.
- Do not point Codex MCP config at `.claude/worktrees/...` unless you intentionally want that exact local worktree.
- `jobhelp-config.json` is local configuration with sensitive values. Do not stage it accidentally.
- `docs/superpowers/specs/*` are working artifacts by default. Do not stage them unless you explicitly decide to keep them.
- `AGENTS.md` is currently a migration asset. Review it before committing, especially any references that were mechanically renamed from Claude to Codex.
- ChatGPT support is deferred. It needs remote MCP or a secure tunnel, plus a decision about auth and user data storage.
