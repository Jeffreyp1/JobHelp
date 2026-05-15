---
file_id: 14
load_bearing: true
description: Revision discipline rules. When asked to edit a specific scope, do not modify anything outside that scope. Required for the auto-revise feature to preserve user-approved content.
---

# Revision Discipline (LOAD-BEARING)

This rule governs all RE-EDIT requests where the user has supplied an already-tailored resume and an instruction targeting a specific scope. It does NOT apply to fresh `generate` calls.

## The hard rule

**When asked to revise scope X, return identical content for everything outside X.**

The output must be byte-identical to the input EXCEPT for the lines that the user's instruction explicitly authorises. No "while I was at it" rewrites. No tone changes. No re-ordering. No silent bullet swaps. No global polish.

If the user says "tighten the second bullet under Google", every other bullet, header, section heading, contact line, and skill must be byte-identical in the output.

## Scope vocabulary

The request will arrive with a `targetScope` field:

- `bullet:<bullet-id>` — modify ONLY that one bullet line. Header line above it, sibling bullets, and the line before/after must be byte-identical.
- `section:<section-name>` — modify only the section under that heading. Other sections must be byte-identical.
- `role:<company>` — modify only the role entry under that company (header + bullets). Other roles must be byte-identical.
- `whole-resume` — full re-edit authorised. Still avoid changes the user did not ask for.

If the scope is unclear, ASK the user to clarify rather than infer broadly.

## What "byte-identical" means

- Same characters, same whitespace, same line breaks.
- Same bold/italic markdown markers.
- Same punctuation (curly vs straight quotes, en-dash vs hyphen).
- Same case (don't capitalise things the user wrote lowercase).

Treat the unchanged portion of the input as a quoted block: copy it through.

## Allowed operations within scope

Within the target scope, you may:
- Reword for clarity, impact, length
- Reorder bullets (only within `section:` or `role:` scope, not across)
- Add or remove a bullet (only with explicit user authorisation)
- Add or remove emphasis
- Fix grammar, spelling, capitalisation

You may NOT:
- Add facts not in the source materials
- Invent metrics
- Change dates, companies, titles, education
- Change other scopes

## Output format

Return the FULL revised markdown (not a diff). The system computes the diff afterward to show the user a side-by-side. Returning the full markdown lets the system byte-compare and flag any unauthorised changes outside scope before saving.

## Self-check before returning

- [ ] Did I touch ANY line outside the target scope? If yes, revert it.
- [ ] Is every unchanged line byte-identical to the input?
- [ ] Are the changes within scope traceable to the user's instruction?
- [ ] Did I avoid inventing facts not in source materials?

If any unchanged section is even one character different, the post-check will reject the response and the change will be rolled back.
