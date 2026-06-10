---
name: auto-apply-update
description: The auto-apply self-update run — reads the gaps log, plans and applies improvements to the auto-apply system inside the autoapply/ folder ONLY, proves each change with tests, and documents everything in a per-run digest. Use when the user says "/auto-apply-update", "run the weekly auto-apply update", "process the gaps log", or a scheduled job invokes it. It never modifies safety rules, personal answers, or anything outside autoapply/.
---

# Auto-Apply Update — hands-off improver with a hard write boundary

You improve the auto-apply system from evidence in the gaps log. You are a
maintenance run, not a feature builder: smallest change that resolves a cluster,
proven by tests, documented, committed. If
`docs/research/autoapply-self-update-knowledge.md` exists locally (it is kept
uncommitted), read it for the system map and update procedures; this skill is
self-sufficient without it.

## Containment (absolute — check before EVERY write and EVERY commit)

1. You may create/modify files ONLY inside `~/JobHelp/autoapply/`.
2. Explicitly forbidden, read-only forever: `.claude/**` (including the
   auto-apply skill's safety rules and THIS skill), `~/.config/jobhelp/
   autoapply-profile.json`, `~/jobhelp/answer-bank.json`,
   `~/jobhelp/autoapply-gaps.jsonl` (append-only input owned by the fillers),
   and every repo file outside `autoapply/`.
3. Commit gate, run before each commit — abort the commit if it prints anything:
   `git diff --cached --name-only | grep -v '^autoapply/'`
4. Never weaken safety semantics from inside the folder either: nothing in
   `autoapply/` may instruct a filler to submit, fabricate, solve captchas, or
   answer personal/EEO questions without a profile-backed source.
5. If a fix genuinely requires a change outside the folder, do not make it —
   put it on the ask-list with the reasoning.

## Pipeline

1. **Cluster** — `cd autoapply/engine && node src/cluster-gaps-cli.ts` (add
   `--json /tmp/clusters.json` if useful). Work from the cluster summary, not
   raw lines.
2. **Route** each cluster:

   | Cluster | Action | Tier |
   |---|---|---|
   | `no-standing-answer`, recurring | Ask-list entry (question, options, count). If the profile ALREADY has a matching concept and only the label wording missed, add a labelRule instead | 3 (1 if labelRule) |
   | Same label unmatched across jobs, profile concept exists | Add `labelRules` entry to `autoapply/overrides.json` | 1 |
   | `unrecognized-widget`, ≥2 occurrences, consistent structure | Playbook row/quirk in `autoapply/playbook/field-playbook.md`; engine code only if the CLI also missed it | 2 |
   | `adapter-miss` concentrated on one ATS | Patch `autoapply/engine/src/ats/<ats>.ts` + add a spec | 2 |
   | `no-truthful-option`, `captcha`, `login-wall`, singletons | Nothing — record as "correct behavior / noise" in the digest | — |
   | `consent-or-signature`, recurring | Ask-list (policy decision is the human's) | 3 |

3. **Apply Tier 1** (data): edit `autoapply/overrides.json`. Constraints: a
   labelRule's `concept` must be an existing profile key; never map demographic
   questions to anything that is not an explicit profile concept; include
   `addedAt` and `evidence`. Validate JSON parses.
4. **Apply Tier 2** (code/playbook), one cluster at a time:
   - Engine code: TDD — failing spec in `autoapply/engine/tests/`, minimal fix,
     then `npm run typecheck` and `npm test` green (keep the output).
   - Playbook edits: re-run the relevant fixture check — serve
     `autoapply/fixtures` (`python3 -m http.server 8765`), exercise the affected
     behavior with the auto-apply flow, confirm no page title ever becomes
     `SUBMIT-FIRED`.
   - Dispatch one reviewer subagent on the staged diff (spec: does the change
     resolve the cluster, nothing more; quality: tests real, no safety drift).
     Reviewer findings → fix → re-review before committing.
5. **Tier 3** — never act; write the ask-list.
6. **Document** — write `autoapply/updates/YYYY-MM-DD.md`:

   ```markdown
   # Auto-apply update — YYYY-MM-DD
   Input: N gaps, M clusters (since <last run date>)
   ## Applied
   - <cluster> → <change> (commit <sha>) — evidence: <test tail / fixture result>
   ## Correct behavior / noise (no action)
   - ...
   ## Ask-list (needs the human)
   - <question> — seen Nx across <companies> — suggested profile key: <key>
   ## Reverted / failed gates
   - <attempt> — why
   ```

7. **Commit** — one commit per applied change plus one for the digest. Stage
   files by name, run the containment gate (rule 3), conventional message
   carrying the evidence one-liner.
8. **Report** — print the digest in chat (that is the run's deliverable).

## Failure handling

- Any gate fails → `git restore` the change, record under "Reverted / failed
  gates", move on. Never commit a red state.
- Cluster ambiguous → ask-list, not a guess.
- Empty/missing gaps log → report "nothing to do" and stop; that is success.
