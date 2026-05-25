import type { ResourceHandler } from './resources.js';

export const PROMPT_NAMES = ['tailor_resumes', 'tailor_resume', 'validate_resume'] as const;

export type PromptName = (typeof PROMPT_NAMES)[number];

export const PROMPT_RESOURCE_URIS: Record<PromptName, string> = {
  tailor_resumes: 'jobhelp://prompts/tailor-resumes',
  tailor_resume: 'jobhelp://prompts/tailor-resume',
  validate_resume: 'jobhelp://prompts/validate-resume',
};

export interface PromptArgument {
  readonly name: string;
  readonly description?: string;
  readonly required?: boolean;
}

export interface PromptDefinition {
  readonly name: PromptName;
  readonly description: string;
  readonly arguments?: readonly PromptArgument[];
}

export interface PromptMessage {
  role: 'user' | 'assistant';
  content: { type: 'text'; text: string };
}

export interface PromptGetResponse {
  _meta: Record<string, never>;
  description: string;
  messages: PromptMessage[];
}

export interface PromptHandler {
  readonly definition: PromptDefinition;
  readonly get: (args?: Readonly<Record<string, string | undefined>>) => PromptGetResponse;
}

type PromptArgs = Readonly<Record<string, string | undefined>>;

function value(args: PromptArgs | undefined, key: string, fallback: string): string {
  const raw = args?.[key];
  if (raw === undefined || raw.trim() === '') return fallback;
  return raw;
}

function message(description: string, text: string): PromptGetResponse {
  return {
    _meta: {},
    description,
    messages: [{ role: 'user', content: { type: 'text', text } }],
  };
}

function tailorResumesText(args?: PromptArgs): string {
  const input = value(args, 'input', '<latest digest, top N jobs, one job id, URLs, or JD text>');
  return `# tailor_resumes

Purpose: orchestrate resume tailoring for 0..N jobs.

User input: ${input}

You are the client AI orchestrator. Use MCP tools and resources to process every requested job. Do not invent experience.

Inputs may be:
- No explicit jobs: use get_latest_digest, or find_matching_jobs when the user asks for top N matching jobs.
- One job id: use get_job for that job.
- Many job ids: process each sequentially.
- URLs or pasted job descriptions: if this client can fetch URLs, extract the JD; otherwise ask the user for the JD text.

For each job:
1. Call start_application.
2. Run the tailor_resume phase to create a resume draft.
3. Run the validate_resume phase automatically.
4. If validation returns BLOCK, give the machine-readable flagged claims back to tailor_resume as prevCritique.
5. Repeat for a maximum of 3 rounds.
6. Stop early when validate_resume returns PASS.
7. For edit rounds, apply tailor_resume mode "edits" mechanically to the previous draft markdown.
8. Write the revised markdown as a new resume version with write_application_output.
9. Validate the exact revised markdown, not the stale prior draft.
10. Write each resume and critique with write_application_output.

Scoped edit flow:
- When the user wants to view the resume and choose specific bullets or sections, call get_resume_outline first.
- For selected bullets or sections, call tailor_resume with scope, selectedIds, selectedMarkdown, and userFeedback.
- In scoped mode, tailor_resume must return only selected replacement markdown, not a full rewritten resume.
- Apply scoped replacements with apply_scoped_resume_edits.
- Write the applied result with write_application_output, then validate_resume against the exact applied markdown.

Validation policy:
- BLOCK if any claim is made-up or exaggerated.
- fair-rephrase claims pass.
- supported claims pass.

Final response:
- total jobs requested
- succeeded PASS count
- BLOCK after 3 rounds count
- skipped count
- per-job output paths or clear failure reasons`;
}

function tailorResumeText(args?: PromptArgs): string {
  const jobId = value(args, 'jobId', '<jobId>');
  const jdText = value(args, 'jdText', '<job description text>');
  const prevCritique = value(args, 'prevCritique', 'null');
  const scope = value(args, 'scope', 'full_resume');
  const selectedIds = value(args, 'selectedIds', '[]');
  const selectedMarkdown = value(args, 'selectedMarkdown', '');
  const userFeedback = value(args, 'userFeedback', '');
  return `# tailor_resume

Purpose: create or revise one tailored resume for one job.

jobId: ${jobId}
jdText: ${jdText}
prevCritique: ${prevCritique}
scope: ${scope}
selectedIds: ${selectedIds}
selectedMarkdown:
${selectedMarkdown}
userFeedback: ${userFeedback}

Sources of truth:
- Candidate facts: jobhelp://resume only.
- Style and formatting rules: jobhelp://rules/merged.
- Job requirements: jdText, or get_job when jdText is not provided.

Rules:
- Never invent employers, titles, dates, metrics, tools, credentials, or accomplishments.
- If the original resume is silent on a requested qualification, omit it.
- Tighten, reorder, and surface real experience only.

Scoped mode:
- scope may be full_resume, selected_section, or selected_bullets.
- If scope is selected_section or selected_bullets, rewrite only selectedMarkdown using userFeedback and jdText.
- Keep the same selection ids in the output.
- Do not call write_application_output in scoped mode; the orchestrator applies replacements with apply_scoped_resume_edits.
- Return JSON: {"mode":"scoped_edits","replacements":[{"selectionId":"<id>","replacementMarkdown":"<markdown>"}]}.

Round 1:
- Produce a full tailored resume in markdown.
- Call write_application_output with kind "resume".
- Return JSON: {"mode":"full","version":<number>,"path":"<written path>"}.

Round 2 or 3:
- Use prevCritique.flagged only.
- Return structured edits only.
- One edit per flagged claim.
- Use replaceWith: null when the claim cannot be grounded in jobhelp://resume.
- Do not change supported or fair-rephrase claims.

Output for edit rounds:
{"mode":"edits","edits":[{"flagId":1,"replaceWith":"<single markdown bullet or null>"}]}`;
}

function validateResumeText(args?: PromptArgs): string {
  const jobId = value(args, 'jobId', '<jobId>');
  const draftMarkdown = value(args, 'draftMarkdown', '<full tailored resume markdown draft>');
  return `# validate_resume

Purpose: check the tailored resume draft for made-up or exaggerated claims.

jobId: ${jobId}
draftMarkdown:
${draftMarkdown}

Read exactly:
- jobhelp://resume, the user's original resume.
- The resume draft provided in draftMarkdown.

Do not read the job description. Do not use hiring-company or JD text as evidence. The original resume is the only evidence source.

Verdict labels:
- supported: directly supported by the original resume.
- fair-rephrase: meaning preserved; no inflation.
- exaggerated: scope, seniority, time, metrics, or impact inflated.
- made-up: no basis in the original resume.

Policy:
- BLOCK if any claim is made-up or exaggerated.
- fair-rephrase claims pass.
- supported claims pass.

Write exactly one critique artifact with write_application_output kind "critique".

Critique must include:
- counts by verdict
- PASS or BLOCK
- every flagged claim with draft text, original evidence or null, and suggested fix
- machine-readable JSON with flagged ids and suggested fixes

Return JSON:
{"verdict":"PASS"|"BLOCK","counts":{"supported":<n>,"fair-rephrase":<n>,"exaggerated":<n>,"made-up":<n>,"total":<n>},"flaggedIds":[<id>]}`;
}

const PROMPTS: readonly PromptHandler[] = [
  {
    definition: {
      name: 'tailor_resumes',
      description: 'Orchestrate resume tailoring for 0..N jobs, always validating each tailored resume.',
      arguments: [{ name: 'input', description: 'User request, job ids, URLs, JD text, or latest/top-N request.' }],
    },
    get: (args) => message('Orchestrate resume tailoring for 0..N jobs.', tailorResumesText(args)),
  },
  {
    definition: {
      name: 'tailor_resume',
      description: 'Create or revise one tailored resume draft using the active resume and merged rules.',
      arguments: [
        { name: 'jobId', description: 'Application job id.', required: true },
        { name: 'jdText', description: 'Job description text.' },
        { name: 'prevCritique', description: 'Validator JSON from the previous round.' },
        { name: 'scope', description: 'full_resume, selected_section, or selected_bullets.' },
        { name: 'selectedIds', description: 'Selection ids from get_resume_outline.' },
        { name: 'selectedMarkdown', description: 'Only the selected resume markdown to rewrite.' },
        { name: 'userFeedback', description: 'User edit instruction for the selected resume text.' },
      ],
    },
    get: (args) => message('Create or revise one tailored resume.', tailorResumeText(args)),
  },
  {
    definition: {
      name: 'validate_resume',
      description: 'Fact-check a tailored resume draft against the original resume.',
      arguments: [
        { name: 'jobId', description: 'Application job id.', required: true },
        { name: 'draftMarkdown', description: 'Full tailored resume draft markdown.', required: true },
      ],
    },
    get: (args) => message('Validate a tailored resume draft.', validateResumeText(args)),
  },
];

export function createPrompts(): readonly PromptHandler[] {
  return PROMPTS;
}

export function createPromptResources(): readonly ResourceHandler[] {
  return PROMPTS.map((prompt) => ({
    descriptor: {
      uri: PROMPT_RESOURCE_URIS[prompt.definition.name],
      name: prompt.definition.name,
      description: `${prompt.definition.description} Prompt fallback resource.`,
      mimeType: 'text/markdown',
    },
    read: async () => {
      const response = prompt.get();
      const text = response.messages[0]?.content.text ?? '';
      return {
        contents: [
          {
            uri: PROMPT_RESOURCE_URIS[prompt.definition.name],
            mimeType: 'text/markdown',
            text,
          },
        ],
      };
    },
  }));
}
