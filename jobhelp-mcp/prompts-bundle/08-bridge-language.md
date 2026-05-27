---
file_id: 8
load_bearing: true
description: Honest bridge phrasing for adjacent skills — "transferable to X" vs "experienced with X" — with confidence levels.
---

# Bridge Language (LOAD-BEARING)

Bridges connect what the candidate has done to what the JD asks for, without overclaiming. They turn ADJACENT (60-74) matches into honest, defensible bullets.

## The hard rule

Use **"methodology transferable to X"** or **"equivalent experience with Y"** — NEVER **"experienced with X"** unless directly demonstrated.

## Phrasing templates

| Confidence | Template |
|---|---|
| HIGH | "Custom solvers (Tool B/Tool C; methodology transferable to Tool A)" |
| HIGH | "Deep learning expertise (PyTorch; directly transferable to TensorFlow)" |
| MEDIUM | "Molecular dynamics (GROMACS; equivalent experience with LAMMPS)" |
| MEDIUM | "Scientific computing in Fortran/C++; transferable to Rust for systems work" |
| LOW | "Adjacent: built CI/CD for one nonprofit project; willing to scale" |

## Confidence levels

### HIGH

Use only when the underlying skill is genuinely the same and only the surface tool differs. Example: PyTorch user bridging to TensorFlow — the math, training loop, and debugging instincts transfer one-to-one.

Mark HIGH when:
- The skill class is the same (deep learning frameworks, FE solvers, distributed databases).
- The tools are recognized substitutes in industry usage.
- The candidate would credibly debug the new tool from existing knowledge after a short ramp.

### MEDIUM

Methodology transfers but the toolchain or domain has real differences the candidate would have to learn.

Mark MEDIUM when:
- The skill class is similar with non-trivial differences (GROMACS vs LAMMPS in force-field config; AKS vs EKS in cloud quirks).
- Industry treats them as related but distinct.
- A short structured ramp closes the gap.

### LOW

Use only when the candidate has touched the skill in a small context, AND no better candidate exists for the slot. Always honest about scale.

Mark LOW when:
- Evidence is one project, one course, one side gig.
- The JD asks for production-grade work but evidence is small.
- The bullet must include actual scale ("3 nonprofits", "course project") rather than implying production.

## Bridge mapping templates

These are pattern shapes; the skill substitutes the candidate's real toolchain.

- Tool A -> "Custom solvers (Tool B/Tool C; methodology transferable to Tool A)" [HIGH]
- Framework A -> "Deep learning (Framework B; directly transferable to Framework A)" [HIGH]
- Simulation Package A -> "MD expertise (Package B; transferable to Package A)" [MEDIUM]
- Cloud A -> "Cloud architecture (Cloud B; transferable to Cloud A)" [MEDIUM]
- Language A -> "Scientific computing (Language B/C; transferable to Language A)" [MEDIUM]
- Domain method A -> "Adjacent: applied [related method] in [domain]" [LOW]

## Forbidden bridge moves

- "Experienced with X" when the candidate has not used X. (Use "transferable to X".)
- Implying production scale when actual evidence is a side project. State scale.
- Stacking bridges to fake breadth ("transferable to X, Y, and Z" when only X is defensible).
- Burying the bridge phrase mid-bullet so the reader skims past the qualifier. Bridges go at a visible position.

## Bridge vs flag a GAP

Bridge when the underlying capability is real and only the surface label differs. Flag a GAP when the JD requires a binary capability the candidate has not exercised. See `07-reframing-strategies.md`.

## Self-check before returning

- [ ] Every "experienced with X" claim is backed by direct experience.
- [ ] Every bridge claim ("transferable to X") includes the actual experience next to it.
- [ ] LOW-confidence bridges include the scale honestly.
- [ ] No bridge implies more than the evidence supports.
