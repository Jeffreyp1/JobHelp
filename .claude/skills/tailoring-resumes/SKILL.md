---
name: tailoring-resumes
description: Use when the user asks to tailor a resume, batch-tailor resumes, or fact-check a tailored resume against the original — phrases like "tailor my resume for these jobs", "make resumes for these 20 links", "build resumes from the latest digest", "validate this resume against my real one". Delegates to the /tailor-batch slash command.
---

# Tailoring resumes

The user wants tailored resumes produced and fact-checked against their original resume. There is a slash command that does exactly this. Use it.

## How to respond

1. Identify the input form:
   - Latest digest → invoke `/tailor-batch latest` (or `/tailor-batch` with no argument).
   - List of jobIds → invoke `/tailor-batch <jobId1> <jobId2> ...`
   - List of URLs → invoke `/tailor-batch <url1> <url2> ...`
   - Single jobId or URL → invoke `/tailor-batch <single>`.

2. If the input form is ambiguous, ask one clarifying question.

3. Do NOT attempt to tailor or validate resumes yourself. Delegate to the slash command. The slash command owns the 3-round loop, edit-application invariants, validator anti-JD discipline, and reporting. Bypassing it produces unsafe output.

## When NOT to use this skill

- The user asks about resume registration, resume parsing, or resume formatting (not tailoring). Different flow.
- The user asks about the Chrome extension's job-scraping behavior. Different surface.
- The user asks to manually edit a resume by hand. Just use Edit.
