import { value, type PromptArgs } from './prompts.js';

export function jobDigestTailorText(args?: PromptArgs): string {
  const count = value(args, 'count', '30');
  const instructions = value(args, 'instructions', '');
  return `# job_digest_tailor

Purpose: run the COMPLETE job pipeline in one invocation: retrieve and rank jobs, AI-match them against the candidate's resume, pause once for approval, then tailor and validate a resume for each approved job.

count: ${count}
instructions: ${instructions}

You are the client AI orchestrator. The MCP server makes NO LLM calls; YOU perform all reasoning. Do not invent experience.

MANDATE - read before starting:
- This task is ALL of phases 1-5 below. It is NOT complete until phase 5 prints a per-job report with tailored output paths.
- find_matching_jobs is step 1 of 5, NOT the deliverable. Do not end your turn after it.
- The ONLY permitted stop is the approval gate in phase 4. Every other phase transition is automatic: finish a phase, then immediately begin the next in the same turn.

Phase 1 - Readiness:
- Call doctor. If the active_resume check is not ok, STOP and report its exact nextStep; the pipeline cannot tailor without an active resume. Otherwise continue immediately to phase 2.

Phase 2 - Retrieve and rank:
- Call find_matching_jobs({ count: ${count} }) to discover, filter, and deterministically rank jobs. Continue immediately to phase 3.

Phase 3 - AI match:
- Call rerank_top_jobs({ topK: ${count}, instructions: "${instructions}" }) to get the top-ranked jobs bundled with the active resume and a structured rerank prompt.
- Apply that rerank prompt yourself: judge each job against the resume and sort every job into exactly one tier - Strong, Solid, Borderline, or Drop - each with a one-line rationale. Continue immediately to phase 4.

Phase 4 - APPROVAL GATE (the one stop):
- Present the Strong and Solid jobs as a shortlist: tier, title @ company, location, remote, one-line rationale.
- STOP and ask which jobs to tailor. The default selection is all Strong and Solid jobs.
- Do not tailor anything until the user confirms. Wait for their reply, then proceed to phase 5 with the confirmed job ids.

Phase 5 - Tailor and validate (after approval):
- The main session is the ORCHESTRATOR ONLY. Do NOT write, draft, edit, or validate any resume yourself. All resume writing happens in dedicated sub-agents, not in this session.
- First re-read BOTH, this run, before tailoring anything: (a) the candidate's COMPLETE resume dump, read in full - the entire registered resume / dump, NOT get_resume_outline and not a summary; and (b) ALL the resume tailoring rules in full (the merged ruleset at jobhelp://rules/merged, every rule). Tailoring and fact-checking must work from the complete source of truth AND the full ruleset, or the validator cannot verify claims and the rules will not be applied consistently.
- Then invoke the /tailor-batch slash command with the confirmed job ids:  /tailor-batch <id1> <id2> ...
  /tailor-batch owns the entire writing loop: it drives the resume-tailor and resume-validator sub-agents through the 3-round draft -> validate loop, applies the byte-exact edit invariants, enforces the validator's anti-JD discipline (the validator never sees the JD), and writes each PASS output. That sub-agent loop is what keeps every resume truthful to the dump - which is why the main session must not bypass it by tailoring inline.
- Wait for /tailor-batch to finish, then take its per-job results as the input to the final report below. Do NOT re-tailor or re-validate anything in this session.

Final report (required - you cannot finish without it):
- jobs retrieved and ranked
- counts per tier (Strong, Solid, Borderline, Drop)
- jobs approved for tailoring
- per-job tailoring status (PASS, BLOCK after 3 rounds, or skipped) with output paths or clear failure reasons`;
}
