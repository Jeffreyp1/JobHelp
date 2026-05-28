import type { CoverLetterTone } from '../types/api-contract.js';

const TONE_DIRECTIVES: Record<Exclude<CoverLetterTone, 'neutral'>, string> = {
  formal:
    'Adopt the "formal" voice profile from 15-cl-tones.md. Use full forms (no contractions), ' +
    'multisyllabic Latinate vocabulary, third-person hints where natural, and measured cadence. ' +
    'Close with constructions such as "I would value the opportunity to discuss...". ' +
    'Structure (HOOK/EVIDENCE/CLOSING) and all anti-fabrication rules remain unchanged.',
  casual:
    'Adopt the "casual" voice profile from 15-cl-tones.md. Use contractions, first-person ' +
    'reflection, and varied sentence lengths. Stay professional — casual is not careless. ' +
    'Close with warm constructions such as "I\'d love to bring this to your team". ' +
    'Structure (HOOK/EVIDENCE/CLOSING) and all anti-fabrication rules remain unchanged.',
  technical:
    'Adopt the "technical" voice profile from 15-cl-tones.md. Lead with metrics, named systems, ' +
    'and precise engineering verbs (instrumented, refactored, sharded). Assume the reader is ' +
    'engineering-savvy; subordinate adjectives to data. Avoid padding adjectives like "robust" ' +
    'or "scalable". Structure (HOOK/EVIDENCE/CLOSING) and all anti-fabrication rules remain unchanged.',
  persuasive:
    'Adopt the "persuasive" voice profile from 15-cl-tones.md. Open with a sharper hook, use ' +
    'vivid verbs, and place a single emotional word per paragraph at most ("compelled", ' +
    '"thrilled", "drawn to"). Energy is the signal, but do not cross into hype or sloganeering. ' +
    'Structure (HOOK/EVIDENCE/CLOSING) and all anti-fabrication rules remain unchanged.',
};

export function buildToneDirective(tone: Exclude<CoverLetterTone, 'neutral'>): string {
  return [
    '\n\n=== TONE: ' + tone + ' ===',
    TONE_DIRECTIVES[tone],
    '=== END TONE ===',
  ].join('\n');
}
