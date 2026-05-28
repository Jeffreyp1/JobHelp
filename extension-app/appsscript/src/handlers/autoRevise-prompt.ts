import type { AutoReviseRequest, ReviseTargetScope } from '../types/api-contract.js';

function describeScope(scope: ReviseTargetScope): string {
  switch (scope.kind) {
    case 'bullet':
      return `the single bullet identified by id "${scope.bulletId}"`;
    case 'section':
      return `the section titled "${scope.sectionName}"`;
    case 'role':
      return `the role/experience entry under company "${scope.companyName}" (its header line and bullets)`;
    case 'whole-resume':
      return 'the entire document';
  }
}

const RULE_14_TEXT = [
  'RULE 14 — REVISION DISCIPLINE (LOAD-BEARING)',
  '',
  'When asked to revise scope X, return identical content for everything outside X.',
  '',
  'The output MUST be byte-identical to the input EXCEPT for lines the user',
  'instruction explicitly authorises. No "while I was at it" rewrites. No tone',
  'changes. No re-ordering. No silent bullet swaps. No global polish.',
  '',
  'Byte-identical means: same characters, same whitespace, same line breaks,',
  'same bold/italic markers, same punctuation (curly vs straight quotes,',
  'en-dash vs hyphen), same case.',
  '',
  'Allowed within scope: reword, reorder (within scope only), add/remove a',
  'bullet (only with explicit instruction), fix grammar, change emphasis.',
  '',
  'Forbidden anywhere: invent metrics, change dates/companies/titles, add',
  'facts not in source, modify any line outside the requested scope.',
  '',
  'Output: return the FULL revised markdown only, no preamble, no fences.',
  'A post-check will byte-compare every line outside the scope and flag any',
  'unauthorised changes — those revisions will be rejected.',
].join('\n');

export function buildSystemPrompt(scope: ReviseTargetScope): string {
  const scopeDesc = describeScope(scope);
  return [
    'You are a precision resume editor. You will be given a markdown resume,',
    'an instruction, and a target scope. Apply the instruction ONLY within',
    'the target scope. Every line outside the scope must be byte-identical',
    'to the input.',
    '',
    RULE_14_TEXT,
    '',
    `Target scope for this request: ${scopeDesc}.`,
  ].join('\n');
}

export function buildUserMessage(req: AutoReviseRequest): string {
  const scopeDesc = describeScope(req.targetScope);
  return [
    'Current markdown:',
    '```',
    req.currentMarkdown,
    '```',
    '',
    `Instruction: ${req.instruction}`,
    '',
    `Scope: ${scopeDesc}`,
    '',
    'Return the FULL revised markdown only — no preamble, no code fences, no explanation.',
  ].join('\n');
}
