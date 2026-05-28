---
file_id: 9
load_bearing: false
description: ATS-safe formatting and section ordering for a 1-page resume tailored to JobHelp's defaults.
---

# Section Structure

JobHelp resumes are **single-page** by default. Every formatting choice serves two readers in sequence: the ATS parser (zero-second machine scan) and the recruiter (~7.4-second F-pattern scan).

## ATS-safe formatting

Resumes that fail to parse are silently dropped. Non-negotiable:

- **Single column.** No two-column layouts; multi-column layouts lose ordering when parsed.
- **No tables.** ATS parsers fragment table cells. Use plain bullet lists.
- **No text inside images, headers, or footers.** Critical text (name, contact) goes in the document body.
- **Plain bullet characters.** Use a regular bullet (•) or hyphen-bullet. No fancy unicode glyphs (➤, ★, ❖).
- **ASCII hyphens for date ranges.** Use `-` or `--`. Em-dashes are fine in prose (subject to the 2-em-dash cap in `05-structural-rules.md`) but not as date separators.
- **One date format throughout.** "Mon YYYY -- Mon YYYY" or "MM/YYYY -- MM/YYYY", consistently.
- **Standard fonts.** Calibri, Arial, Helvetica, Times, Cambria, Garamond.
- **Searchable text only.** No text rendered as image.
- **Reasonable margins.** 0.5"-1".

## Section ordering

### Early-career (student, new grad, <3 years)

1. Header (name, contact, location, links)
2. Education
3. Skills
4. Experience
5. Projects (if substantive and JD-relevant)
6. Selected Awards / Activities (if JD-relevant)

Education leads because the degree is the strongest fresh signal.

### Experienced (3+ years)

1. Header
2. Professional Summary (2-4 sentences, optional)
3. Experience
4. Skills
5. Education
6. Selected Awards / Publications (if JD-relevant)

Experience leads because the work record is the strongest signal.

### Career pivot

Use the experienced ordering, but the Professional Summary becomes mandatory — it carries the bridge sentence framing the pivot. See `08-bridge-language.md`.

## 1-page constraint

JobHelp's default is a 1-page resume. To fit:

- ~6 high-signal bullets total for early-career, ~10-12 for experienced.
- 3-5 publications max (if JD-relevant), 2 awards max.
- Skills section: 3-5 categorized lines, not a wall of tools.
- Cut any bullet that is not DIRECT or TRANSFERABLE for this JD (see `07-reframing-strategies.md`).
- Do not shrink fonts below readable size to fit content. Cut content instead.

## The 7.4-second F-pattern recruiter scan

Eye-tracking studies show the average initial scan takes ~7.4 seconds and follows an F-pattern: top horizontal line, second line, then a vertical glance down the left edge. Implications:

- **Top of document is highest leverage.** Header + first bullet of first position must carry the strongest JD-relevant signal.
- **Left edge is high-signal.** First 3-5 words of every bullet, every position title, every section heading.
- **Bottom of page is rarely read.** Do not save the strongest bullet for the bottom of the last position.

## Header content

- Name (largest text on page).
- One contact line: email + phone + city/state. LinkedIn and one portfolio/GitHub if relevant.
- Do NOT include: full street address, photo, age, marital status, headshot.

## Section headers

Use clear, conventional names: "Experience", "Education", "Skills". ATS keyword matching looks for standard headers.

## Self-check before returning

- [ ] Single column, no tables, plain bullets, ASCII hyphens.
- [ ] Section order matches early-career vs experienced rule.
- [ ] Top of page carries the strongest JD-relevant signal.
- [ ] Document fits one page at readable font size.
- [ ] Standard section header names throughout.
