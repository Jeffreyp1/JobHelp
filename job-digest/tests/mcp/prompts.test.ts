import { describe, expect, it } from 'vitest';
import {
  createPrompts,
  PROMPT_NAMES,
  PROMPT_RESOURCE_URIS,
} from '../../mcp/src/prompts.js';

describe('createPrompts', () => {
  it('lists the portable resume workflow prompts', () => {
    const prompts = createPrompts();
    expect(prompts.map((p) => p.definition.name).sort()).toEqual([...PROMPT_NAMES].sort());
  });

  it('tailor_resumes describes the 0..N orchestration loop', () => {
    const prompt = getPrompt('tailor_resumes');
    const text = prompt.get({ input: 'top 25 jobs' }).messages[0]?.content.text ?? '';
    expect(text).toContain('0..N');
    expect(text).toContain('prepare_batch_applications');
    expect(text).toContain('top 25');
    expect(text).toContain('One job id: call prepare_batch_applications({ jobIds: [id] }) before tailoring');
    expect(text).toContain('tailor_resume');
    expect(text).toContain('validate_resume');
    expect(text).toContain('maximum of 3 rounds');
    expect(text).toContain('apply tailor_resume mode "edits" mechanically');
    expect(text).toContain('apply_validator_resume_edits');
    expect(text).toContain('Validate the exact revised markdown');
    expect(text).toContain('validate_resume against the exact applied markdown');
    expect(text).toContain('get_resume_outline');
    expect(text).toContain('apply_scoped_resume_edits');
    expect(text).toContain('write_application_output');
    expect(text).toContain('per-job status');
  });

  it('tailor_resumes names apply_validator_resume_edits payload fields', () => {
    const prompt = getPrompt('tailor_resumes');
    const text = prompt.get({ input: 'top 25 jobs' }).messages[0]?.content.text ?? '';
    const instruction = text
      .split('\n')
      .find((line) => line.includes('apply_validator_resume_edits')) ?? '';
    expect(instruction).toContain('resumeMarkdown');
    expect(instruction).toContain('critique');
    expect(instruction).toContain('edits');
    expect(instruction).not.toContain('prevCritique');
  });

  it('validate_resume documents the critique schema accepted by validator edit application', () => {
    const prompt = getPrompt('validate_resume');
    const text = prompt.get({ jobId: 'adzuna:1', draftMarkdown: '# R' }).messages[0]?.content.text ?? '';
    expect(text).toContain('"schemaVersion":1');
    expect(text).toContain('"jobId":"adzuna:1"');
    expect(text).toContain('"resumeVersion"');
    expect(text).toContain('"thresholdConfig"');
    expect(text).toContain('"blockOn"');
    expect(text).toContain('"flagged"');
    expect(text).toContain('"draftText"');
    expect(text).toContain('"originalEvidence"');
    expect(text).toContain('"suggestedFix"');
    expect(text).not.toContain('"flaggedIds"');
  });

  it('tailor_resume is vendor-neutral and names MCP context primitives', () => {
    const prompt = getPrompt('tailor_resume');
    const text = prompt.get({ jobId: 'adzuna:1', jdText: 'Build APIs' }).messages[0]?.content.text ?? '';
    expect(text).toContain('jobhelp://resume');
    expect(text).toContain('jobhelp://rules/merged');
    expect(text).toContain('scope');
    expect(text).toContain('selectedIds');
    expect(text).toContain('selectedMarkdown');
    expect(text).toContain('write_application_output');
    expect(text).not.toMatch(/Codex|Claude Agent|Cursor/);
  });

  it('validate_resume blocks made-up and exaggerated claims but allows fair-rephrase', () => {
    const prompt = getPrompt('validate_resume');
    const text = prompt.get({ jobId: 'adzuna:1', draftMarkdown: '# Resume' }).messages[0]?.content.text ?? '';
    expect(text).toContain('draftMarkdown');
    expect(text).toContain('# Resume');
    expect(text).not.toContain('draftPath');
    expect(text).not.toContain('localPath');
    expect(text).not.toContain('get_job');
    expect(text).toContain('made-up');
    expect(text).toContain('exaggerated');
    expect(text).toContain('fair-rephrase');
    expect(text).toContain('BLOCK if any claim is made-up or exaggerated');
    expect(text).toContain('fair-rephrase claims pass');
  });

  it('exposes resource fallback URIs for all prompts', () => {
    expect(Object.keys(PROMPT_RESOURCE_URIS).sort()).toEqual([...PROMPT_NAMES].sort());
    expect(PROMPT_RESOURCE_URIS.tailor_resumes).toBe('jobhelp://prompts/tailor-resumes');
    expect(PROMPT_RESOURCE_URIS.tailor_resume).toBe('jobhelp://prompts/tailor-resume');
    expect(PROMPT_RESOURCE_URIS.validate_resume).toBe('jobhelp://prompts/validate-resume');
  });
});

function getPrompt(name: string) {
  const prompt = createPrompts().find((p) => p.definition.name === name);
  if (prompt === undefined) throw new Error(`missing prompt: ${name}`);
  return prompt;
}
