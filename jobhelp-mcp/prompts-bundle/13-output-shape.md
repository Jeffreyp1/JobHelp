---
file_id: 13
load_bearing: true
description: Strict markdown output shape required for the template-fill flow to extract content correctly.
---

# Output Shape (LOAD-BEARING)

Your output MUST match this exact markdown shape. Deviations break the
downstream template-fill pipeline. No prose, no preamble, no closing notes —
only the resume markdown.

> Note: the Experience role header uses an ASCII hyphen (`-`) before the
> italic city/state segment, not an em-dash. Earlier drafts used `—` here,
> but rule 05's 2-em-dash cap means that pattern would push every multi-role
> resume over the cap. Hyphen is intentional and locks in cleaner ATS
> output too. See `05-structural-rules.md:17`.

## Required structure

```
# {Full Name}
{email} | {phone or site} | {linkedin url} | {github url} | {portfolio url}

## Skills
**{Category 1}:** {comma-separated items}
**{Category 2}:** {comma-separated items}
**{Category 3}:** {comma-separated items}

## Experience

**{Job Title}** {Company} | *- {City}, {ST}* | {Date Range}
- **{Lead}:** {rest of bullet — what you did, with metrics}
- **{Lead}:** {rest of bullet}

**{Job Title}** {Company} | *- {City}, {ST}* | {Date Range}
- **{Lead}:** {rest}

## Projects

**{Project Title}** | *{site or repo url}*
- {bullet text}
- {bullet text}

**{Project Title}** | *{site or repo url}*
- {bullet text}

## Education

**{School}** – {Degree} | {Date}
**{School}** – {Degree} | {Date}
```

## Strict rules

- Section headings are EXACTLY `## Skills`, `## Experience`, `## Projects`, `## Education`. No alternates ("Work History", "Technical Skills", etc.).
- Skill lines start with `**Category:**` (bold category, then colon, then plain items).
- Each Experience role header line uses pattern `**Title** Company | *- City, ST* | DateRange` — the `*- City, ST*` segment is italic, prefixed by an ASCII hyphen (not an em-dash; see rule 05's em-dash cap).
- Each bullet under a role uses `- **Lead:** rest` — the lead word/phrase before the colon must be bolded.
- Project header lines use `**Project Title** | *url-or-link*` — no other format.
- Project bullets use `- text` (no bold lead required).
- Education lines use `**School** – Degree | Date` (en-dash between school and degree, matching the template above).
- Output ONLY the resume markdown. No code fences, no commentary, no "Here is your resume:" preamble.

## Self-check before returning

- [ ] First line is `# {Name}`
- [ ] Second line is the contact line with ` | ` separators
- [ ] Section headings match the four required `##` headings exactly
- [ ] Every Experience header matches the title/company/location/dates pattern
- [ ] Every Experience bullet has a bolded lead followed by `:` then content
- [ ] Output starts with `#` and contains no preamble
