---
name: job-pipeline
description: Use when the user wants a full JobHelp run in one command — "/job-pipeline", "run my pipeline", "daily job run", "find jobs and tailor resumes", "run the digest and make resumes for the best ones" — or any request that asks for job discovery AND application materials in the same breath.
---

# Job Pipeline

One command that takes the user from "what's out there" to fact-checked tailored resumes: discover → AI rerank → tiers → tailor. It exists because the deterministic digest kept being shown to the user as if it were a recommendation list, and the AI judgment steps were skipped unless the user manually demanded them.

**Core principle: raw BM25 rankings are never shown to the user. Tiers or nothing.**

## Hard gates

1. **After `find_matching_jobs` returns, do NOT present, summarize, or paraphrase its job list.** The result's `nextRequiredStep` field is binding. The only valid next action is Step 2.
2. **Only tiered output may be shown** (Strong/Solid/Borderline/Drop with per-job reasons, per the job-rerank rubric).
3. **Tailoring covers the Strong tier.** Zero Strong jobs → ask the user whether to tailor Solid instead; never silently widen.
4. **Stop after tailoring.** Suggest `/auto-apply` with the tailored file paths; do not start it.

## Steps

1. **Discover.** Call `mcp__jobhelp__find_matching_jobs` (pass the user's count and any free-text emphasis as `instructions`). If it returns `not_configured`, run `mcp__jobhelp__doctor`, report what setup is missing, and stop.
2. **Rerank (mandatory).** Invoke the `job-rerank` skill and follow it exactly. Do not substitute your own quick judgment for its rubric.
3. **Present tiers.** Show the tier table with reasons. This is the first moment the user sees jobs.
4. **Tailor.** Run `/tailor-batch <strong-tier jobIds>` (3-round tailor + validator loop). Report each resume path and its validation verdict.
5. **Close out.** One summary: tiers, tailored resume paths, validation results, and the suggested next command (`/auto-apply <paths>`).

## Red flags — stop and go back to the gates

- "The BM25 order looks reasonable, I'll just show the top 10" → Gate 1 violation. Rerank first.
- "User seems in a hurry, skip the rerank this once" → the rerank IS the product; the raw score routinely ranks un-takeable jobs first (wrong country, clearance, seniority).
- "I'll tailor everything in the digest" → Gate 3. Strong tier only unless the user widens it.
- "Might as well start auto-apply" → Gate 4. Never.
- "There's already a digest from earlier, I'll present it directly" → same rules: rerank it (`get_latest_digest` output is also raw).

## Edge cases

- All sources failed → report the per-source errors from the tool result; suggest `validate_sources`.
- Strong tier empty → ask: tailor Solid tier, or stop at the shortlist?
- User passed specific jobIds/URLs only → skip discovery; rerank still applies before tailoring more than one.
