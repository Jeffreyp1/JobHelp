# Greenhouse Token Validation Report

Generated: 2026-05-18T20:03:30.834Z

## Summary

- Total candidates probed: 975
- Validated (HTTP 200): 264
- Rejected: 711

## Source breakdown

| Source                     | Candidates | Validated |
|----------------------------|-----------:|----------:|
| SimplifyJobs/Summer2026    | 59 | 58 |
| SimplifyJobs/New-Grad      | 33 | 32 |
| Prior knowledge / probes   | 893 | 183 |

Tokens that appear in more than one source are counted in each, so column sums exceed totals.

## Rejected by HTTP status

- 404: 711

## Sample rejected tokens

- `1password` -> 404
- `1x` -> 404
- `1xtechnologies` -> 404
- `23andme` -> 404
- `a16zcrypto` -> 404
- `aave` -> 404
- `abbvie` -> 404
- `abnormal` -> 404
- `acorns` -> 404
- `adept` -> 404
- `adeptai` -> 404
- `adeptailabs` -> 404
- `adobe` -> 404
- `adobe1` -> 404
- `adobeinc` -> 404
- `adobesystems` -> 404
- `afterpay` -> 404
- `agility` -> 404
- `aiola` -> 404
- `airbyte` -> 404
- `akuna` -> 404
- `alchemy` -> 404
- `alchemyplatform` -> 404
- `alibaba` -> 404
- `almacommunity` -> 404
- `alnylam` -> 404
- `amd` -> 404
- `americanexpress` -> 404
- `amex` -> 404
- `amgen` -> 404

## Notable big-name tokens validated

- `a16z`
- `abnormalsecurity`
- `affirm`
- `agilityrobotics`
- `airbnb`
- `amplitude`
- `anthropic`
- `apollo`
- `appliedintuition`
- `apptronik`
- `astranis`
- `attentive`
- `block`
- `braze`
- `brex`
- `chime`
- `cloudflare`
- `creditkarma`
- `cresta`
- `cribl`
- `cybereason`
- `databricks`
- `datadog`
- `descript`
- `discord`
- `doubleverify`
- `duolingo`
- `expel`
- `fanduel`
- `figma`
- `figure`
- `figureai`
- `fireworksai`
- `fivetran`
- `gitlab`
- `gleanwork`
- `gusto`
- `huntress`
- `imbue`
- `inflectionai`
- `instabase`
- `iterable`
- `jetbrains`
- `klaviyo`
- `lattice`
- `lookout`
- `magic`
- `mercury`
- `monzo`
- `neuralink`
- `paradigm`
- `pathai`
- `peloton`
- `pendo`
- `pingidentity`
- `planetlabs`
- `planetscale`
- `recursionpharmaceuticals`
- `reddit`
- `roblox`
- `salesloft`
- `sofi`
- `stabilityai`
- `stripe`
- `sumologic`
- `thetradedesk`
- `thinkingmachines`
- `togetherai`
- `twitch`
- `underdogfantasy`
- `unity3d`
- `vercel`
- `webflow`

## Validation method

Each candidate token was probed against:

```
GET https://boards-api.greenhouse.io/v1/boards/<token>/jobs?per_page=1
```

Tokens returning HTTP 200 were kept. Throttled to ~4 concurrent requests with 220ms spacing. No 429s observed during the run.

## Sources mined

1. SimplifyJobs/Summer2026-Internships README (parsed all greenhouse apply URLs)
2. SimplifyJobs/New-Grad-Positions README (same)
3. Prior knowledge of well-known Greenhouse customers (Stripe, Anthropic, Vercel, etc.) plus targeted variant probing (e.g. `<name>`, `<name>inc`, `<name>ai`, `<name>labs`)

Many large-name tech companies were probed but do not use Greenhouse (they use Lever, Ashby, Workday, or in-house ATSes). Those were dropped as 404s, e.g. `adobe`, `amd`, `alibaba`, `andela`, `atlassian`, `box`, etc.

## Files

- JSON list: `jobhelp-mcp/scripts/greenhouse-tokens.json` (sorted alphabetically, one token per line)
- This report: `jobhelp-mcp/scripts/greenhouse-tokens-report.md`
