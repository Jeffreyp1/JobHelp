# @jeffreyp1/jobhelp-job-digest

Core library for the JobHelp `/job-digest` system: discover, normalize, rank, and digest job postings.

This package is **in-progress**. Phase 1 (this directory) is the core library — three deployment surfaces (Claude Code skill, MCP server, CLI) wrap it in later phases.

## Layout

```
core/
  types/        ← contracts (locked in this commit, do not edit without coordination)
  lib/          ← logger, config loader, claude wrapper  (Agent D)
  sources/      ← one file per adapter (Adzuna, Greenhouse, Lever)  (Agent A)
  pipeline/     ← normalize, filter, dedupe (stub), rank  (Agent B)
  digest/       ← orchestrator + markdown + CSV formatter  (Agent C)
tests/          ← vitest, one file per behavior
```

## Build commands

```bash
npm install         # install deps
npm run typecheck   # tsc --noEmit
npm test            # vitest run
npm run test:coverage
```

## Spec

See `../docs/superpowers/specs/2026-05-14-job-digest-design.md` for the full design.
