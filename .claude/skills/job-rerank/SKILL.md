---
name: job-rerank
description: Rerank JobHelp's ranked jobs against the user's actual resume and profile, sorting them into Strong/Solid/Borderline/Drop tiers and returning the best ones to apply to. Use this whenever the user wants to know which jobs to apply to, which matches are best, to "rerank" or "re-rank" a digest, to pick the top jobs from the latest find_matching_jobs / find-matching-jobs run, or to turn a long list of ranked jobs into a short apply-now shortlist. Trigger it even when the user just says things like "which of these should I apply to", "what are my best matches", "narrow these down", or "go through the digest" — the deterministic BM25 score alone is not a hiring decision, and this skill adds the resume-and-constraints judgment that the score is missing.
---

# Job Rerank

## Why this skill exists

JobHelp's pipeline ends with a deterministic BM25F score (fetch → filter → rank). That score is a coarse keyword/recency signal computed against a *config skills list*, not the user's actual resume, and it knows nothing about hard constraints like work authorization or clearance. So the top of the BM25 list routinely contains jobs the user literally cannot take (senior roles for an early-career candidate, TS/SCI-clearance jobs, wrong-country postings) sitting above genuinely better matches.

This skill is the judgment layer the score is missing. It reads the user's real resume and profile constraints, removes the things that are non-starters, scores what's left on how well it actually fits *this person*, and returns a short, honest, apply-now shortlist with reasons. The whole point is to save the user from either trusting a misleading score or hand-reading 50 job descriptions every time.

A core promise: **never invent a job.** Every job in the output must come from the input set. Fabricating or "improving" a posting would send someone to apply to something that doesn't exist.

## Inputs

Default path (MCP connected): first call `get_triage_list` to learn the digest depth.

- **Total <= 50 jobs (small digest):** skip the funnel. Call `rerank_top_jobs` (optionally `{ topK: 50 }`) and apply the rubric below to the bundle — the exact legacy flow.
- **Total > 50 jobs:** run **Funnel mode** (next section) so every retrieved job gets a look. Never silently judge only the top of a big list.

Either way the deep bundle returns the jobs to rerank, the active resume, and a summary. That bundle is your working set.

If the tools report no digest, tell the user to run `find_matching_jobs` first; do not fabricate a digest.

## Funnel mode (large digests)

The digest may hold up to ~1000 ranked jobs, but only the deep pass reads full descriptions. Funnel = cheap skim of ALL jobs, deep read of survivors.

1. **Fetch:** `get_triage_list` -> `{ total, lines, profileCard, triage: { model, chunkSize } }`. Each line is `<rank>. <id> | <title> @ <company> | <location> | <remote> | <posted> | skills:<matched> | s=<score>`.
2. **Chunk:** split `lines` into consecutive chunks of `triage.chunkSize`.
3. **Skim in parallel:** dispatch one subagent per chunk in a single message (Agent tool, `model: triage.model` — this is a config knob in `~/.config/jobhelp/config.json` under `ranking.triage.model`; do not hardcode a model name). Each subagent prompt contains:
   - the `profileCard`,
   - the Stage-1 dealbreakers from the rubric below, verbatim,
   - the tier definitions (strong/solid/borderline/drop),
   - its chunk of lines,
   - the output contract: ONLY one JSON object per input line, `{"id":"<id>","tier":"strong|solid|borderline|drop"}`, no prose, no fences. A line whose verdict is missing or unparseable is treated as `borderline` (never silently dropped).
4. **Merge:** survivors = all `strong` + `solid`; add `borderline` while survivors < 15. Cap at 100 by tier first (strong > solid > borderline), then digest rank.
5. **Deep pass:** `rerank_top_jobs({ jobIds: survivors })` -> apply the full rubric below to the bundle exactly as in the small-digest flow. Report any `summary.missingIds`.
6. **Coverage line (mandatory, last line of output):** `Coverage: triaged <returned>/<total> jobs, deep-read <K>, dropped <M> at triage.` If `truncated` was true, say how many jobs were beyond the triage cap.

Triage tiers are provisional — only Stage-1 dealbreakers and the final rubric decide anything the user sees. A triage `drop` is never shown as a recommendation, but the count must appear in the coverage line so nothing is silently ignored.

If the user instead pastes a list of jobs and points to a resume file, use those directly. The rubric below is identical regardless of where the jobs come from.

Profile constraints (seniority, allowed countries / work authorization, remote preference, salary floor) come from the JobHelp config/profile. If the bundle includes them, use them. If they are not present, read them from the resume and from anything the user has told you in the conversation, and state the assumptions you made so the user can correct you.

## The rubric (frozen)

Apply the stages in order. Stage 1 is pass/fail and runs first, because no amount of skill match rescues a job the user cannot legally or practically take.

### Stage 1 — Dealbreakers (hard drop)

Drop a job outright, regardless of score, if any of these are true. A Stage-1 drop is final: the job goes in the **Dropped** section with its reason — it must NEVER appear in Top picks, Strong, Solid, or Borderline, not even with a "confirm eligibility" caveat. The user asked which jobs to *apply to*; a job they're not authorized for is not a borderline reach, it's a drop. Always state *why* it was dropped so the user can override.

- **Work authorization / location mismatch.** The job's country/region is outside the user's allowed set, and it is not remote in a region the user can work. A US-authorized candidate cannot take a "Bengaluru, India" or "Remote — Ireland/UK only" role — those are hard drops, not borderline reaches. The ONLY location that survives ambiguity is a bare "Remote" with no country attached: keep it and note the ambiguity. A named foreign city/country is a drop even when the posting also says "remote" (e.g. "Remote in the Philippines"), because the remote is scoped to that country.
- **Clearance the user does not hold.** TS/SCI, Secret, polygraph, "US Citizen — clearance required," etc. These are multi-month gates a candidate either has or doesn't; treat as a hard drop unless the user has said they hold it.
- **Seniority far above the user.** For an early-career / new-grad / entry profile, drop titles that are unambiguously senior: Staff, Principal, Distinguished, Director, Engineering Manager, "Senior … (10+ yrs)", Architect. A plain "Senior" with otherwise strong fit can be a Borderline reach rather than a hard drop — use judgment and explain it.
- **Role family the user is not pursuing.** If the user targets software engineering and the posting is sales, marketing, nursing, mechanical engineering, etc., drop it. (The deterministic filter catches most of these, but some slip through on generic titles.)

### Stage 2 — Score the survivors

Judge each remaining job on these dimensions. These are weights for your reasoning, not a formula to compute to two decimals — the goal is a defensible ordering, not false precision.

- **Skill overlap with the resume (heaviest).** How many of the job's real requirements does the resume actually demonstrate? Weight depth and recency: a skill the user shipped production work with beats one mentioned once. Read the resume, don't just count keyword hits.
- **Seniority fit.** Best when the level matches the user's actual experience. An "Engineer I" / "Junior" / "New Grad" title for an early-career candidate is a strong positive signal, not a neutral one.
- **Domain / interest alignment.** Does the job's domain connect to what the user has built or said they want? A candidate with LLM-tooling and agentic-AI projects fits an "AI engineer" role more than a generic CRUD role even at equal skill overlap.
- **Growth signal.** Reputable company, real engineering, room to grow. A recognizable strong-engineering employer is a tie-breaker, not an override — a great-fit role at an unknown company still beats a poor-fit role at a famous one.
- **Logistics.** Remote/hybrid/onsite vs the user's preference, salary vs floor, recency of the posting.

### Stage 3 — Assign tiers

- **Strong (apply first):** title + level + stack + domain align with the resume. The user is a credible, competitive applicant. Few or no gaps.
- **Solid (good shot):** 2 of 3 of {stack, level, domain} align; one notable but bridgeable gap.
- **Borderline (stretch / only if interested):** one dimension aligns, or a real gap in a load-bearing area (e.g. a "Senior" reach). Worth it only if the user specifically wants that company/domain.
- **Drop:** Stage-1 dealbreakers, plus anything that survived Stage 1 but clearly mismatches on review.

### Near-duplicate handling

The same role is often posted multiple times (different locations or req IDs from one company). Collapse them: surface the single best instance (best location/level for the user) and note "also posted in X, Y" rather than spending three shortlist slots on one job.

## Output format

Lead with the shortlist — that is what the user came for. Then show the tiers for transparency, then the dealbreakers so the user can challenge any drop.

```
## Top picks to apply to

1. **<Company> — <Title>** (<remote/hybrid/onsite>, <location>) — <one sentence: why this is a top pick for THIS user, naming the concrete overlap>
   Apply: <url>   [watch-out: <the one real caveat, if any>]
2. ...
(up to ~10)

## Tiers

**Strong:** <Company — Title> · <Company — Title> · ...
**Solid:** ...
**Borderline (reach):** ...

## Dropped (with reason)

- <Company — Title> — <dealbreaker, e.g. "TS/SCI clearance required">
- <Company — Title> — <e.g. "Remote Ireland/UK only; outside US work authorization">
- (collapse near-dupes here too: "Contentful Fullstack ×3 — kept Berlin, dropped London/Dublin dupes")
```

Number of top picks: aim for ~10, but return fewer rather than padding. If only 4 jobs are genuinely worth applying to, return 4 and say so. A padded shortlist defeats the purpose — the user will waste time on weak applications and trust the tool less.

## Calibration notes

- **Be honest, drop aggressively, don't pad.** The failure mode users hate most is a shortlist full of jobs they can't get or don't want. It is better to return 5 real matches than 10 with filler.
- **Justify every top pick with a concrete overlap**, not vibes. "Strong React/Node/AWS overlap and an Engineer-I title that fits your level" is useful; "great match!" is not.
- **Surface, don't hide, the reaches.** If you put a "Senior" role in Borderline, say it's a reach and why it might still be worth it — let the user decide.
- **State your assumptions** when profile constraints weren't provided (e.g. "Assuming US work authorization and early-career level from your resume — tell me if that's wrong and I'll redo the tiers").
- The rubric is intentionally fixed so results are consistent run to run. Do not silently invent new dimensions; if the user asks to weight something specific (e.g. "I only care about remote"), honor it as an explicit override and say you did.
