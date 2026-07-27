---
name: retrieve-profile
description: Build or refresh the user's JobHelp profile by reading their resume and asking for the preferences a resume can't reveal, then writing it into the JobHelp config so the filter, BM25 ranker, and job-rerank skill all match jobs against accurate, current data. Use this whenever the user wants to set up their profile, "sync my resume," fix bad job matches that stem from a stale or hand-typed skills list, update their target locations / remote preference / salary / seniority, or right before a first job search when the config looks empty or wrong. Trigger it when the user says things like "my matches are off," "update my profile," "I changed my resume," "I only want remote now," or "set me up for job search" — the deterministic pipeline silently ranks against config.profile, so if that's stale every downstream result is wrong.
---

# Retrieve Profile

## Why this skill exists

JobHelp's filter and BM25 ranker do not read the resume. They read `config.profile` — `skills`, `seniority`, `roleFamily`, `salaryFloor`, `remoteOk`, `allowedCountries`, `location`. If that profile is a stale, hand-typed guess (the common case), then *every* downstream result is computed against the wrong person: good jobs get filtered out, junk gets ranked high, and the job-rerank skill inherits a polluted candidate set.

This skill fixes the source. It pulls what it can from the resume (skills actually demonstrated, seniority, years of experience, role direction) and **asks the user** for the things a resume genuinely cannot reveal (where they'll work, remote vs hybrid vs onsite, relocation, clearance, salary floor). Then it proposes a profile, gets the user's approval, and writes it to config so the whole pipeline — deterministic filter, ranker, and the AI rerank — all judge jobs against the same accurate picture.

Two firm principles:

- **Infer facts, ask preferences.** Skills and years-of-experience are facts in the resume — extract them. Location willingness, remote preference, relocation, and salary floor are *decisions* the resume cannot contain — never invent them; ask. Guessing a preference is worse than leaving it blank, because a wrong `allowedCountries` silently filters out real jobs.
- **Propose, then write.** Always show the user the profile you intend to write and get a yes before writing. This is their config; a silent overwrite that quietly changes their search is exactly the kind of surprise to avoid.

## Inputs and outputs

Read the current state first so you're updating, not clobbering:
- Resume: `read_resume` (MCP) for the active resume, or a file path the user gives.
- Current config: `config` (MCP) to see what's already set.

Write with `init_config` (MCP) — it accepts a *partial* profile and merges it into the existing config, returning the merged result and the path written. If the MCP isn't connected, fall back to editing the config JSON directly (default `~/.config/jobhelp/config.json`, or `$JOBHELP_CONFIG_PATH`); on Claude.ai with no filesystem, present the final JSON for the user to save themselves.

## What to extract from the resume (facts)

- **skills**: the technologies the resume actually demonstrates, weighted toward things the user *shipped*, not just listed. Prefer canonical names ("TypeScript", "PostgreSQL", "AWS"). Don't pad with every buzzword — a focused list ranks better than a kitchen sink, because BM25 query terms come straight from this.
- **seniority**: one of `intern | entry | mid | senior | staff`. Infer from graduation date, total professional experience, and titles held. A 2024 grad with internships is `entry`, not `mid` — be honest; an inflated seniority makes the filter drop good entry roles as "too junior" and surface senior roles the user can't get.
- **years of experience (YOE)**: compute from the work history. Hold this for the rerank/filter even though the current config schema has no dedicated field — surface it to the user and note it (see "Gaps" below).
- **roleFamily**: the role directions the resume supports and the user is pursuing (e.g. `backend`, `fullstack`, `frontend`, `ml`, `ai-engineer`). Confirm with the user rather than assuming — a resume can support several directions the user isn't actually targeting.

## What to ask the user (preferences — never infer)

Ask these directly, in plain language, and keep it short. Offer sensible defaults but make clear they're guesses:

1. **Remote / hybrid / onsite** — which are you open to? (sets `remoteOk`; if they say remote-only, note it for the rerank too)
2. **Locations** — which countries/regions can you actually work in (work authorization), and which cities are you open to or willing to relocate to? (sets `allowedCountries` and `location`) — this is the highest-leverage answer; a wrong value here silently filters out real jobs, so confirm it explicitly.
3. **Salary floor** — minimum you'd accept, in USD. (sets `salaryFloor`; 0 disables the filter)
4. **Clearance** — do you hold an active security clearance (e.g. TS/SCI, Secret)? Most candidates don't; if not, clearance-gated jobs should be dropped. (no config field yet — see Gaps)

If the user is terse or says "just use the resume," extract the facts, make explicit assumptions for the preferences, write them, and clearly list every assumption so they can correct any one.

## Workflow

1. Read the current config and the resume.
2. Extract the facts (skills, seniority, YOE, roleFamily) from the resume.
3. Ask the preference questions above (batch them — don't interrogate one at a time unless the user prefers that).
4. Show the proposed profile as a clean before/after diff against the current config, with a one-line reason for any non-obvious choice (especially seniority and roleFamily).
5. On approval, write via `init_config` (or the fallback) and confirm the path written.
6. Tell the user what changed downstream: "Your filter and ranker now use this — re-run find_matching_jobs to see the difference."

## Output format for the proposal

```
## Proposed profile

| Field | Current | Proposed | Why |
|---|---|---|---|
| skills | [old] | [new] | extracted from resume; dropped X (not shipped), added Y |
| seniority | [old] | entry | 2024 grad + internships = early-career |
| roleFamily | [old] | backend, fullstack | resume supports these; confirm you're targeting them |
| salaryFloor | [old] | 80000 | your answer |
| remoteOk | [old] | true | your answer |
| allowedCountries | [old] | US | your answer (work authorization) |
| location | [old] | Austin, TX | your answer |

YOE detected: ~1.5 years (internships + projects)  [no config field yet — used by rerank/filter judgment]
Clearance: none  [no config field yet — rerank will drop clearance-gated jobs]

Write this to config? (yes / edit / cancel)
```

## Gaps to flag to the user (honest limitations)

The current JobHelp config schema has fields for skills, seniority, roleFamily, salaryFloor, remoteOk, allowedCountries, and location — but **not** for years-of-experience or clearance. So this skill can set the first group directly (which immediately improves the deterministic filter and ranker), but YOE and clearance can only be carried as judgment into the job-rerank skill until those fields are added to the config + filter. Tell the user this plainly rather than pretending the deterministic filter will enforce a YOE or clearance gate it doesn't have yet. If they want those enforced deterministically, that's a follow-up code change to the filter, not something this skill can do alone.

## Calibration notes

- **Don't inflate the resume.** The skills list should reflect demonstrated ability; if you wouldn't defend it in an interview, don't add it. An honest profile produces honest matches.
- **Seniority honesty is load-bearing.** It's the single field most likely to silently wreck results in both directions. When unsure between two levels, pick the lower and say why.
- **Preferences are the user's call, always.** Your job is to ask clearly and record accurately, not to talk them into a wider or narrower search.
- **Re-runnable.** This skill is meant to be run again whenever the resume or situation changes; it should always read current state first and propose a diff, never assume a blank slate.