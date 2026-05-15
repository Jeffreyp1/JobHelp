---
file_id: 12
load_bearing: false
description: How to extract a structural template from a sample resume and reproduce it exactly for future generations.
---

# Template Reproduction

When the user supplies a sample resume, JobHelp must reproduce its **structural template** for all future generations — not just its content. Goal: a tailored draft reads as the same document with different content, not a different document.

## What to extract from a sample resume

### 1. Section order

List section names in order. Common patterns:

- Header, Summary, Experience, Skills, Education
- Header, Education, Skills, Experience, Projects, Awards
- Header, Summary, Skills, Experience, Education, Publications

Record the actual ordering. Do not reorder.

### 2. Header style

- Name size and weight ("18pt bold, centered" or "14pt left-aligned").
- Contact line composition: which of {email, phone, city, LinkedIn, GitHub, portfolio} are present, in what order.
- Separator characters (`|`, `•`, `--`, line break).
- Whether the header has a horizontal rule below it.

### 3. Section heading style

- Heading case (ALL CAPS, Title Case, Sentence case).
- Heading underline or rule (yes/no).
- Heading font size relative to body.
- Spacing above/below.

### 4. Bullet style

- Bullet character (`•`, `-`, `*`, en-dash).
- Indent depth.
- Full-width or hung-indent?
- Each bullet ends with a period or no terminal punctuation?
- Bullets-per-position pattern.

### 5. Position header style

- Single line or multi-line position header?
- Order of {role title, employer, location, dates} on those lines.
- Date format ("Jan 2022 -- Present", "01/2022 -- 12/2024", "2022-2024").
- Bold/italic conventions for role title vs employer.

### 6. Date format conventions

Pick one canonical date format and apply everywhere:

- "Mon YYYY -- Mon YYYY"
- "MM/YYYY -- MM/YYYY"
- "YYYY -- YYYY"
- "Mon YYYY -- Present"

Mismatched formats break the F-pattern scan.

### 7. Skills section format

- Categorized (Languages: ...; Frameworks: ...) or flat list?
- Number of categories, typical items per category.
- Bold/italic conventions for category labels.

## Reproducing the template

Once extracted, the template binds the next generation:

1. **Same section order.** Even if the JD would benefit from a different default order (see `09-section-structure.md`), prefer the user's existing order.
2. **Same header layout.** Same fields, separators, name styling.
3. **Same heading style.** Same case, underline behavior.
4. **Same bullet character and indentation.** No surprise switches.
5. **Same date format throughout.** Apply to every position, education, project.
6. **Same bullets-per-position rhythm.** If the sample uses 3 per position, target 3.
7. **Same skills format.** Categorized stays categorized.

## When to deviate

Only when:

- The sample format violates an ATS-safety rule. Fix it and tell the user.
- The user asks for a structural change explicitly.
- This JD requires a section the sample lacks. Add minimally.

## Failure mode to avoid

A common failure: preserving content faithfully but quietly changing format — same bullets but suddenly bold-italic dates and a different bullet character. The user notices the format change first and loses trust. Reproduce the format exactly.

## Self-check before returning

- [ ] Section order matches the sample.
- [ ] Header layout matches the sample.
- [ ] Heading style matches the sample.
- [ ] Bullet character and indentation match.
- [ ] Date format consistent throughout and matches the sample.
- [ ] Bullets-per-position rhythm matches the sample.
- [ ] Skills format (categorized vs flat) matches the sample.
