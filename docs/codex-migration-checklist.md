# Codex Migration Checklist

Run this before relying on the Codex migration setup, and again before staging migration files.

## Agent Pairing

```bash
test -f .claude/agents/karen-code-review.md
test -f .codex/agents/karen-code-review.toml
test -f .claude/agents/karen-the-auditor.md
test -f .codex/agents/karen-the-auditor.toml
test -f .claude/agents/karen-the-fixer.md
test -f .codex/agents/karen-the-fixer.toml
test -f .claude/agents/karen-the-manager.md
test -f .codex/agents/karen-the-manager.toml
test -f .claude/agents/resume-tailor.md
test -f .codex/agents/resume-tailor.toml
test -f .claude/agents/resume-validator.md
test -f .codex/agents/resume-validator.toml
```

Expected result: all commands exit `0`.

## Skill And Command Pairing

```bash
test -f .claude/commands/tailor-batch.md
test -f .claude/skills/tailoring-resumes/SKILL.md
test -f .agents/skills/tailoring-resumes/SKILL.md
test -f .agents/skills/source-command-tailor-batch/SKILL.md
test -f jobhelp-mcp/mcp/src/prompts.ts
```

Expected result: all commands exit `0`.

## Portable MCP Prompts

```bash
cd jobhelp-mcp
npx vitest run tests/mcp/prompts.test.ts tests/mcp/resources.test.ts tests/mcp/index.test.ts
```

Expected result: `tailor_resumes`, `tailor_resume`, and `validate_resume` are listed as MCP prompts, and the same text is available through `jobhelp://prompts/*` resource fallbacks.

## MCP Config

```bash
sed -n '1,80p' .codex/config.toml
test -f jobhelp-mcp/mcp/dist/mcp/src/bin.js
```

Expected result: `.codex/config.toml` points at a real MCP command. Prefer a portable command such as `npx -y @jeffreyp1/jobhelp-mcp`, or intentionally point at `jobhelp-mcp/mcp/dist/mcp/src/bin.js` after building locally.

Warning: do not point Codex MCP config at `.claude/worktrees/...` unless that exact worktree exists and you intentionally want to use it.

## Secret And Local-Only Files

Before staging, run:

```bash
git status --short
git check-ignore -v jobhelp-config.json .codex/config.toml
```

Do not stage these by accident:

- `jobhelp-config.json`, because it can contain API keys and Drive IDs.
- `.codex/config.toml`, if it contains personal absolute paths.
- `.claude/settings.local.json`.
- `.claude/worktrees/*`.
- `docs/superpowers/specs/*`, unless you explicitly decided to preserve the working artifact.
- `jobhelp-mcp/scripts/companies-all.json` and `jobhelp-mcp/scripts/companies-report.md`, until reviewed.
- `scripts/render-jakestyle.mts`, until reviewed.

## Staging Discipline

Stage migration files explicitly by name. Do not use `git add .` or `git add -A`.

For the docs-only migration kit, the intended files are:

```bash
git add docs/codex-transition.md
git add docs/codex-claude-map.md
git add docs/codex-migration-checklist.md
git add .codex/README.md
```

Only add `.codex/agents/*`, `.agents/skills/*`, or `AGENTS.md` after reviewing them separately.
