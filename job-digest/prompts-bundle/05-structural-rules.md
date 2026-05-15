---
file_id: 5
load_bearing: false
description: Sentence-level and prose-level structural rules plus positive markers of human writing.
---

# Structural Rules

Pattern-level AI fingerprints. Banned words alone won't catch these.

## Sentence-level

- **No reframe pattern.** Never use "It's not X — it's Y" constructions.
- **No rhetorical Q+A.** Never ask a question then answer it ("What makes this unique? The answer is..."). The loudest AI tell in cover letters.
- **No gerund fragment stacking.** Avoid sequences of three or more "-ing" phrases in a row ("developing, testing, and deploying...").
- **No -ing analysis endings on bullets.** This is the #1 structural AI marker. Bullets must NOT end with "-ing" phrases like "...advancing the field," "...contributing to improved efficiency," "...enabling new capabilities." Restructure so the bullet ends with a concrete result, metric, or named artifact. Endings like "...contributing to a 15% reduction" are fine because they end on a metric. Endings like "...contributing to improved efficiency" are not.
- **Em-dash cap: max 2 per document.** Count every `---` (or `—`) in the full document. If the count exceeds 2, replace extras with commas, semicolons, parentheses, or new sentences. Cover letters accumulate em-dashes fastest. Fellowships/Honors items use ". " separators, never em-dashes.

## Prose-level

- **Vary sentence length.** Mix short (8-12 words) with long (20-30 words). Three consecutive sentences of similar length flag as AI.
- **No same-structure paragraph starts.** If P1 opens "My research...", P2 must NOT open "My experience..." and P3 must NOT open "My approach..."
- **No constant triplet structures.** Avoid "X, Y, and Z" lists in more than 2 sentences per document.
- **No uniform bullet rhythm.** If every bullet has the same verb-object-result cadence, the document reads as templated. Vary openings within constraints.

## Positive markers (signals of human writing)

What the document SHOULD have:

1. **Specific details.** "Ran 847 MD simulations on protein variants" beats "Conducted extensive simulations."
2. **Front-loaded specifics.** Lead with the concrete object, not the framing.
3. **Named entities.** Tool names, method names, journal names, institution names, framework versions.
4. **Audience-appropriate jargon.** Use the JD's own vocabulary.
5. **Short connecting words.** "so," "but," "and," "then" — not "consequently," "however," "additionally," "subsequently."
6. **First-person specificity in CLs.** "I built" not "Was responsible for building."
7. **Inside knowledge.** Specific group names, lab names, product code-names that are visible only after homework.
8. **Sentence length variety.** Mix of 8-word and 25-word sentences within the same paragraph.
9. **Occasional "And" or "But" sentence openers** in CLs (max 1-2 per page).
10. **One human detail per CL page.** A specific lab memory, a conference conversation, a problem that kept you up.
11. **Contractions in industry CLs.** "I've", "didn't" are acceptable. Avoid in academic/lab CLs.

## Cover letters get extra weight

CLs are prose-heavy and human readers have strong intuitions about how people write. Apply every rule above with extra strictness in CLs:

- Opening sentence MUST be specific to the target.
- Sentence-length variety is mandatory, not optional.
- Em-dash count compounds fastest in CLs — recount before submitting.

## Post-generation scan

After every document, scan all bullets for -ing endings, count em-dashes, and check paragraph openings. Any structural failure is a Tier 1 fix.
