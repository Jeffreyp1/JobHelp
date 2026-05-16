---
file_id: 11
load_bearing: true
description: The pre-return self-scan — 12-item AI fingerprint check plus the critical "before you return" verification.
---

# Self-Scan Checklist (LOAD-BEARING)

Run this scan on every generated resume and cover letter before showing it to the user. Any failure is a Tier 1 fix.

## Part A — 12-item AI fingerprint scan

Scan for each item. Any single hit means rewrite, not polish.

1. [ ] Any Tier 1 banned word? (delve, leverage, utilize, harness, spearhead, tapestry, synergy, multifaceted, pivotal, realm, paradigm, holistic, foster, cornerstone, cutting-edge, novel, innovative, groundbreaking) — see `03-banned-words.md`.
2. [ ] Any banned phrase from `04-banned-phrases.md`?
3. [ ] More than 2 em-dashes (`---` or `—`)? Count both.
4. [ ] Any bullet ending with an -ing analysis phrase? See `05-structural-rules.md`.
5. [ ] Three or more consecutive sentences of similar length? Mix lengths.
6. [ ] Paragraph starts repeat the same structure? ("My research...", "My experience...", "My approach...".)
7. [ ] More than 2 "X, Y, and Z" triplet structures across the document?
8. [ ] CL opens with a generic phrase instead of a company-specific reference?
9. [ ] Any metaphorical use of "landscape," "journey," "realm," or "tapestry"? (Literal uses are fine.)
10. [ ] Passive voice in more than ~20% of bullet verbs? Active wins.
11. [ ] Honors / Awards / Fellowships items use `---` instead of `. ` separators?
12. [ ] Any banned adverb (meticulously, notably, subsequently, seamlessly, holistically)?

## Part B — Before you return: critical checklist

Compresses the highest-priority verifications.

### Accuracy and provenance
- [ ] Every quantitative claim traces to the experience file (no fabricated numbers).
- [ ] Author position on every cited paper matches the actual record.
- [ ] Publication status matches the provenance table.
- [ ] No internal folder name appears as a software package.
- [ ] No LOC counts or test counts.
- [ ] Verbs match ownership level.
- [ ] Dates, company names, and titles match the source record exactly.

### Bullet construction
- [ ] Every bullet contains a number OR a concrete proper-noun artifact.
- [ ] No bullet starts with a forbidden opener (Responsible for, Helped, Worked on, etc.).
- [ ] No bullet ends with an -ing analysis phrase.
- [ ] First bullet of each position is the strongest match for this JD.

### Structure and AI fingerprint
- [ ] Em-dash count <= 2.
- [ ] No banned word survived the scan.
- [ ] No banned phrase survived the scan.
- [ ] Sentence-length variety in any prose section.
- [ ] Paragraph openings do not repeat structure.

### Cover letter (if applicable)
- [ ] Word count is 250-300 (industry default).
- [ ] 3 paragraphs (HOOK / EVIDENCE / CLOSING).
- [ ] P1 references something specific about the company.
- [ ] No defensive framing about background gaps.
- [ ] Every CL claim traces to a resume bullet.

### Format integrity
- [ ] Single column, no tables, plain bullets, ASCII hyphens for date ranges.
- [ ] Date format consistent throughout.
- [ ] One page (resume default).
- [ ] Standard section headers (Experience, Education, Skills).

### ATS coverage
- [ ] >= 70% of the JD's high-priority keywords appear verbatim.
- [ ] Any high-frequency JD term (3+ JD mentions) appears at least once truthfully, or is honestly bridged.

## What to do when a check fails

1. Identify which rule file owns the failed check (e.g., a banned word -> `03-banned-words.md`).
2. Apply the fix exactly as that rule prescribes.
3. Re-run affected sub-scans.
4. Only after all checks pass, present the document.
