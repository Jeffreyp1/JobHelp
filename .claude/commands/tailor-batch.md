---
description: "Tailor and fact-check resumes for one or more jobs. Accepts: a digest reference (latest), a list of jobIds, or a list of URLs."
---

You are the orchestrator for the resume-tailoring batch loop. Your job is to drive `resume-tailor` and `resume-validator` agents over one or more jobs, applying the 3-round loop and the byte-exact edit invariants defined in `docs/superpowers/specs/2026-05-17-resume-tailor-validator-design.md`.

## Step 0 — re-read the full context first (before any tailoring)

Before parsing input or starting any job, re-read the complete source material **this run** so nothing tailors from stale or partial context:

1. Re-read the candidate's **COMPLETE resume dump in full** — the entire registered resume (`jobhelp://resume`), not an outline (`get_resume_outline`) and not a summary.
2. Re-read **ALL the resume tailoring rules in full** — the merged ruleset (`jobhelp://rules/merged`), every rule, not a subset.

Every `resume-tailor` and `resume-validator` invocation below must operate against this complete dump and full ruleset. Do not start the per-job loop until both have been re-read this run.

## Input parsing

The user invokes `/tailor-batch <input>`. Interpret `<input>` as one of:

1. **Empty or "latest"** → call `mcp__jobhelp__get_latest_digest` and extract jobIds.
2. **A comma- or whitespace-separated list of strings** starting with `http://` or `https://` → URL-list mode. Run each through the URL gate (see "URL ingestion" below).
3. **Any other comma- or whitespace-separated list** → treat as jobIds. For each, call `mcp__jobhelp__get_job(jobId)` to fetch the JD text. If any jobId fails, skip it with a clear reason.

Normalize to a list of `{ jobId, jdText, sourceLabel }` pairs before starting the per-job loop.

## URL ingestion

For each URL:

1. Call `WebFetch(url, "Extract the full job description text, company, and role title. Return verbatim where possible. If the page is a login wall, captcha, 403, or otherwise unreadable, state that explicitly at the start of your response.")`.
2. WebFetch returns processed text, not a numeric HTTP status. Translate to the gate's expected `{ status, body }` shape:
   - If the response text starts with "The server returned HTTP " followed by a number → set `status` to that number, `body` to the rest.
   - Else if the response contains the substring "HTTP 403" or "Forbidden" or matches the WebFetch-emitted error preamble → `status: 403`, `body: <response>`.
   - Else → `status: 200`, `body: <full response text>`.
   (The gate's body markers will catch login walls and captchas regardless of the status translation.)
3. Pipe the translated result through the gate script. The heredoc with a quoted sentinel (`<<'JOBHELP_EOF'`) prevents shell expansion of any quotes, backticks, or `$(...)` in the JSON payload:
   ```bash
   cat <<'JOBHELP_EOF' | npx tsx scripts/url-content-gate.mts
   { "url": "...", "fetch": { "status": <n>, "body": "..." } }
   JOBHELP_EOF
   ```
4. If `accepted: false`, add the URL to the skip list with the gate's `reason`. Do not start an application for it.
5. If `accepted: true`, use the returned `jobId` and the fetched body as `jdText`. Call `mcp__jobhelp__start_application(jobId)` (idempotent).

## Per-job loop

For each `{ jobId, jdText, sourceLabel }`:

1. Call `mcp__jobhelp__start_application(jobId)` (idempotent).
2. Initialize `prevCritique = null`.
3. For round N in 1..3:
   - **Invoke resume-tailor** via the Agent tool with `subagent_type: "resume-tailor"`. Prompt: include `jobId`, `jdText`, and `prevCritique` (or "null").
   - Parse the tailor's return:
     - If `mode: "full"` (round 1): the tailor has already written the resume. Read the version number from the return value. Read the new file content for the next step.
     - If `mode: "edits"` (round N > 1): the tailor returned an edits JSON. Apply it mechanically. The heredoc with a quoted sentinel (`<<'JOBHELP_EOF'`) prevents shell expansion of any quotes, backticks, or `$(...)` in the JSON payload:
       ```bash
       cat <<'JOBHELP_EOF' | npx tsx scripts/apply-tailor-edits.mts
       { "prevContent": "...", "critique": <prevCritique>, "edits": <tailor return> }
       JOBHELP_EOF
       ```
       If the script returns `ok: false`, the tailor's edits failed an invariant. Re-invoke the tailor ONCE with the failure reason ("Your edits failed invariant: <stage> — <errors>"). If it fails again, abort this job, surface a per-job error, and continue to the next job.
       On success, write the resulting content as the next resume version via `mcp__jobhelp__write_application_output(jobId, "resume", content)`.
   - **Invoke resume-validator** via the Agent tool with `subagent_type: "resume-validator"`. Prompt: include `jobId` and the absolute `draftPath` to the just-written resume version. Do NOT pass `jdText` to the validator.
   - Parse the validator's return JSON. If `verdict: "PASS"`, break the loop with success. Otherwise set `prevCritique = <the validator's critique markdown's machine-readable JSON block>` and continue.
4. If the loop exhausts 3 rounds with `BLOCK`, mark this job as "BLOCK after 3 rounds" with the residual flagged claims.

## Final report

After all jobs:

```
# Tailor-batch report

- Total jobs: <N>
- Succeeded (PASS): <count>
- BLOCK after 3 rounds: <count>
- Skipped at URL gate: <count>
- Other errors: <count>

## Succeeded
- <jobId> (v<N>): <sourceLabel>
...

## BLOCK after 3 rounds
- <jobId> (v<N>): <residual flag count> flagged — see ~/jobhelp/applications/<jobId>/critique.md

## Skipped at URL gate
- <url>: <reason>
...

## Other errors
- <jobId or url>: <reason>
...
```

## Discipline
- Never pass JD text to the validator. Not in any prompt, not in any tool call. The validator's tool allowlist does not include `get_job`; do not give it any URL to fetch either.
- The orchestrator (you) is the only thing that knows about "rounds." Neither agent decides round transitions.
- Run jobs sequentially in v1. Do not parallelize.

## Single-job convenience

If `<input>` is exactly one jobId or URL, run the same loop for just that one and produce the same report format with one row.
