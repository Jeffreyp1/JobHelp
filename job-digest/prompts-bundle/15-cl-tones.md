---
file_id: 15
load_bearing: false
description: Cover letter tone profiles (formal / casual / technical / persuasive / neutral). Complements 10-cover-letter-industry.md.
---

# Cover Letter — Tone Profiles

Five voice presets the user can select. Tone modulates word choice and sentence
cadence; it does NOT change the HOOK / EVIDENCE / CLOSING structure mandated by
`10-cover-letter-industry.md`, nor the anti-fabrication and banned-word rules.
When the user picks a tone, this profile applies on top of the universal CL
rules — never instead of them.

## formal

A buttoned-up corporate register suitable for legacy enterprises, regulated
industries, and senior leadership audiences. Prefer multisyllabic Latinate
vocabulary, full sentences, and an even, measured cadence. Address the reader
with deference without becoming stiff. Avoid first-name familiarity. Example
closing: "I would value the opportunity to discuss how my background aligns
with this role."

- DO use full forms: "I am", "do not", "will not".
- DO favor "would value", "would welcome", "look forward to".
- DO write in third-person hints where natural ("the position", "the team").
- DON'T use contractions or colloquialisms.
- DON'T open with "Hi" or close with "Cheers"; use "Dear" / "Sincerely".

## casual

A warm, first-person voice for early-stage startups, creative agencies, and
roles where culture-fit signals matter. Sentences may be shorter; rhythm may
vary. Maintain professionalism — casual is not careless. Example closing:
"I'd love to bring this to your team and would jump at a chance to chat."

- DO use contractions: "I'm", "don't", "I'd".
- DO use first-person reflection: "what excites me about", "I keep coming back to".
- DO vary sentence length; allow one short punchy sentence per paragraph.
- DON'T use slang, emoji, or exclamation marks beyond at most one.
- DON'T sacrifice specificity — casual still demands real metrics.

## technical

A dense, evidence-forward voice for engineering, ML, infrastructure, and
research roles where the reader is technical. Lead with numbers, architectures,
and proper-noun systems. Subordinate adjectives to data. Assume the reader
recognizes domain terms — define only what's load-bearing for the claim.

- DO foreground metrics (p99 latency, RPS, MAU, %, $) and named tech.
- DO use precise verbs: "instrumented", "refactored", "indexed", "sharded".
- DO compress where possible — short clauses chained by semicolons are fine.
- DON'T pad with adjectives ("robust", "scalable", "cutting-edge").
- DON'T over-explain widely known systems (Postgres, Kafka, S3, etc.).

## persuasive

A higher-affect voice for sales, business development, marketing, founding,
and customer-facing roles where energy is the signal. Hooks should land harder;
the closing should make the reader want to reply today. Use vivid verbs; use
emotional words sparingly (one per paragraph maximum) so they keep weight.

- DO open with a sharp, specific hook that names a stake or contrast.
- DO use vivid verbs: "shipped", "won", "compounded", "unlocked", "rebuilt".
- DO use emotional words ("compelled", "thrilled", "drawn to") at most once each.
- DON'T pile on superlatives or stack emotional words back-to-back.
- DON'T cross into hype, hard-sell, or anything resembling a pitch deck slogan.

## neutral (default)

The current baseline behavior when no tone is specified. Balanced professional
register: neither stiff nor familiar. Equal weight on metrics and narrative.
This is what `10-cover-letter-industry.md` already produces — documented here
for completeness so the absence of a tone directive is a known state, not an
omission.

- DO write in standard professional English.
- DO use contractions sparingly — about one per paragraph or fewer.
- DO follow `10-cover-letter-industry.md` without modulation.
- DON'T pick a register; let the content carry the voice.
- DON'T add tonal flourishes when the user has not requested any.
