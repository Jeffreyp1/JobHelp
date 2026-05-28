# Changelog

## [0.2.0] - 2026-05-15

### Added

- `apply_config_answers` MCP tool — persists wizard answers to `~/.config/jobhelp/config.json`. Closes the init_config first-run gap.
- Filter-side ranker improvements (Phase 5): role-family classifier, ghost/template detection, strict-senior rule. Drops top-20 noise by ~40% on the live test.

### Changed

- Promoted from `0.2.0-alpha.0` to `0.2.0` stable. README's `npx -y @jeffreyp1/jobhelp-mcp` now resolves to this version.
- `package.json`: added `repository`, `bugs`, `homepage` fields; added `postbuild` script to chmod the bin executable.

## [0.2.0] - 2026-05-15

### Changed

- Pivoted to Design B (zero-API-key, MCP-first). The MCP server is now the primary deliverable; no `ANTHROPIC_API_KEY` required.
- Package renamed to `@jeffreyp1/jobhelp-mcp`.
- LLM fit-score path in `core/pipeline/rank.ts` removed. `ranking.useLlmFitScore: true` is silently ignored; `breakdown.llmFitScore` and `llmRationale` are always `undefined`. Score is deterministic `keywordOverlap * recencyBoost` only.
- `callClaude` import removed from `rank.ts`; `fetchLlmFitScores` helper and all batched-LLM logic deleted.
- `core/lib/claude.ts` and `@anthropic-ai/sdk` were removed from the package; the MCP server relies on the client AI for all LLM work.
- Test count reduced from 153 to 150: removed 5 LLM-mock tests from `tests/pipeline/rank.test.ts`, added 2 deterministic-contract tests (score formula, `useLlmFitScore` force-false).

## [0.1.0] - 2026-05-14

### Added

- Initial Phase 1 release: `core/sources/` (Adzuna, Greenhouse, Lever), `core/pipeline/` (normalize, filter, dedupe, rank), `core/digest/` (generate, format), `core/lib/` (log, config, claude).
- 153 vitest tests, strict TypeScript.
