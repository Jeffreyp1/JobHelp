---
file_id: 3
load_bearing: false
description: Tier 1 banned words and approved replacements that fingerprint AI-generated resumes.
---

# Banned Words

Single-word AI tells. If you would write any word in this file, swap it for the replacement before the bullet leaves the buffer.

## Tier 1 — Dead Giveaways (NEVER use)

delve, leverage, utilize, harness, spearhead, tapestry, synergy, multifaceted, pivotal, realm, paradigm, holistic, nuanced, foster, embark, cornerstone, landscape (metaphorical), journey (metaphorical), cutting-edge, novel, innovative, groundbreaking

## Banned Adjectives — use the replacement

| Banned | Replacement |
|---|---|
| robust | strong, reliable |
| comprehensive | thorough, broad |
| innovative | new, original (or omit) |
| pivotal | key, central |
| meticulous | careful, precise |
| diverse | varied, wide-ranging |
| extensive | broad, deep, 10+ years of |
| seamless | direct, clean (often: omit) |

## Banned Verbs — use the replacement

| Banned | Replacement |
|---|---|
| leverage | use, apply, draw on |
| utilize | use |
| harness | apply, use, draw on |
| spearhead | lead, start, launch |
| foster | support, build, grow |
| facilitate | run, lead, coordinate, enable |
| showcase | show, demonstrate |
| underscore | show, highlight |
| bolster | strengthen, support |
| streamline | simplify, cut steps in |

## Banned Adverbs

meticulously, notably, subsequently (use "then" or "later"), remarkably, seamlessly, thereby, holistically

## Banned Nouns (metaphorical use)

tapestry, landscape, journey, realm, synergy, paradigm, cornerstone

## Technical exceptions

- "landscape" is fine when literal: "free energy landscape," "threat landscape," "data landscape" describing a real surface.
- "novel" is acceptable only when quoting a JD verbatim or naming a specific algorithm/method that is established as such in literature.
- "pipeline" is fine for actual data/CI pipelines. Banned only when used metaphorically for "process."
- Domain terms that happen to look like banned words (e.g. chemistry's "synergistic effect" with cited evidence) are fine when literal.

## Search before returning

Before any draft is presented, run a case-insensitive scan for every Tier 1 word above. Any hit is a Tier 1 fix — repair before showing the user.

This file is the secondary safety net. The primary defense is generating from specific, named, quantified experience content.
