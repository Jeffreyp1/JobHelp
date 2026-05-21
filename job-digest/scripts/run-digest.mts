import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runDigest } from '../core/digest/generate.js';
import { aiFilter, buildAIFilterPrompt, type AIJudgment, type Judger, type Tier } from '../core/pipeline/ai-filter.js';
import type { JobDigestConfig, ProfileConfig, RankedJob } from '../core/types/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
function loadSlugs(file: string, fallback: readonly string[]): readonly string[] {
  const p = join(__dirname, file);
  return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as readonly string[]) : fallback;
}
const greenhouseTokens = loadSlugs('greenhouse-tokens.json', ['stripe', 'vercel']);
const ashbyTokens = loadSlugs('ashby-slugs.json', ['ramp']);
const leverSlugs = loadSlugs('lever-slugs.json', ['plaid']);
const smartrecruitersTokens = loadSlugs('smartrecruiters-slugs.json', ['visa']);
const recruiteeTokens = loadSlugs('recruitee-slugs.json', ['bunq']);
const teamtailorTokens = loadSlugs('teamtailor-slugs.json', ['polestar']);
const breezyTokens = loadSlugs('breezy-slugs.json', []);
const pinpointTokens = loadSlugs('pinpoint-slugs.json', ['workwithus']);
const personioTokens = loadSlugs('personio-slugs.json', ['personio']);

// Adzuna auto-activates when ADZUNA_APP_ID + ADZUNA_APP_KEY are set; omitted otherwise.
const adzunaAppId = process.env['ADZUNA_APP_ID'];
const adzunaAppKey = process.env['ADZUNA_APP_KEY'];
const adzunaSource = adzunaAppId !== undefined && adzunaAppKey !== undefined
  ? { adzuna: { appId: adzunaAppId, appKey: adzunaAppKey, country: 'us', queries: ['software engineer', 'backend engineer', 'fullstack engineer'] } }
  : {};

// USAJobs auto-activates when USAJOBS_API_KEY + USAJOBS_EMAIL are set; omitted otherwise.
const usajobsApiKey = process.env['USAJOBS_API_KEY'];
const usajobsEmail = process.env['USAJOBS_EMAIL'];
const usajobsSource = usajobsApiKey !== undefined && usajobsEmail !== undefined
  ? { usajobs: { apiKey: usajobsApiKey, email: usajobsEmail, queries: ['software engineer', 'backend engineer', 'fullstack engineer'] } }
  : {};

// JSearch auto-activates when JSEARCH_API_KEY is set; omitted otherwise.
const jsearchApiKey = process.env['JSEARCH_API_KEY'];
const jsearchSource = jsearchApiKey !== undefined
  ? { jsearch: { rapidApiKey: jsearchApiKey, queries: ['software engineer', 'backend engineer', 'fullstack engineer'] } }
  : {};

const config: JobDigestConfig = {
  profile: {
    resumeDumpPath: '/tmp/resume.md',
    skills: [
      'typescript', 'javascript', 'python', 'node', 'react',
      'backend', 'frontend', 'fullstack', 'distributed systems',
      'kubernetes', 'aws', 'postgres',
    ],
    location: 'Irvine, CA',
    remoteOk: true,
    salaryFloor: 100000,
    seniority: 'mid',
    roleFamily: ['backend', 'fullstack', 'frontend'],
  },
  // workable omitted: Cloudflare-blocks this IP. adzuna included only when its API keys are set.
  sources: {
    greenhouse: { tokens: greenhouseTokens },
    ashby: { tokens: ashbyTokens },
    lever: { slugs: leverSlugs },
    smartrecruiters: { tokens: smartrecruitersTokens },
    recruitee: { tokens: recruiteeTokens },
    teamtailor: { tokens: teamtailorTokens },
    breezy: { tokens: breezyTokens },
    pinpoint: { tokens: pinpointTokens },
    personio: { tokens: personioTokens },
    remoteok: {},
    remotive: { queries: ['typescript', 'python backend', 'fullstack engineer'] },
    yc: { queries: ['software engineer', 'backend engineer', 'fullstack engineer'] },
    weworkremotely: {
      categories: [
        'remote-full-stack-programming-jobs',
        'remote-back-end-programming-jobs',
        'remote-front-end-programming-jobs',
      ],
    },
    ...adzunaSource,
    ...usajobsSource,
    ...jsearchSource,
  },
  ranking: { topN: 200, digestK: 50 },
  rules: { userRulesDir: '/tmp/rules-demo', mode: 'additive' },
  output: { dir: '/tmp/jobhelp-demo' },
};

async function claudeSdkJudger(jobs: readonly RankedJob[], profile: ProfileConfig): Promise<readonly AIJudgment[]> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic();
  const prompt = buildAIFilterPrompt(jobs, profile);
  const res = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  });
  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
  return parseJudgmentLines(text);
}

function parseJudgmentLines(text: string): readonly AIJudgment[] {
  const out: AIJudgment[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || !trimmed.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(trimmed) as { id?: string; tier?: string; rationale?: string };
      if (typeof parsed.id !== 'string') continue;
      if (parsed.tier !== 'strong' && parsed.tier !== 'solid' && parsed.tier !== 'borderline' && parsed.tier !== 'drop') continue;
      out.push({ id: parsed.id, tier: parsed.tier as Tier, rationale: parsed.rationale ?? '' });
    } catch {
      // skip malformed lines
    }
  }
  return out;
}

function preloadedJudger(path: string): Judger {
  return async (): Promise<readonly AIJudgment[]> => {
    const text = readFileSync(path, 'utf8');
    return parseJudgmentLines(text);
  };
}

function pickJudger(): { judger: Judger | null; mode: string } {
  const preload = process.env['AI_JUDGMENT_FILE'];
  if (preload !== undefined && preload.length > 0 && existsSync(preload)) {
    return { judger: preloadedJudger(preload), mode: `preloaded:${preload}` };
  }
  if (process.env['ANTHROPIC_API_KEY']) {
    return { judger: claudeSdkJudger, mode: 'claude-sdk:haiku-4-5' };
  }
  return { judger: null, mode: 'disabled (set ANTHROPIC_API_KEY or AI_JUDGMENT_FILE)' };
}

const t0 = Date.now();
console.log('\n──────────────────────────────────────────────────────');
console.log('JobHelp digest — live run + AI final filter');
console.log('──────────────────────────────────────────────────────');
const { judger, mode } = pickJudger();
const totalBoards = greenhouseTokens.length + ashbyTokens.length + leverSlugs.length + smartrecruitersTokens.length + recruiteeTokens.length + teamtailorTokens.length + breezyTokens.length + pinpointTokens.length + personioTokens.length;
console.log(`  greenhouse:        ${greenhouseTokens.length}`);
console.log(`  ashby:             ${ashbyTokens.length}`);
console.log(`  lever:             ${leverSlugs.length}`);
console.log(`  smartrecruiters:   ${smartrecruitersTokens.length}`);
console.log(`  recruitee:         ${recruiteeTokens.length}`);
console.log(`  teamtailor:        ${teamtailorTokens.length}`);
console.log(`  breezy:            ${breezyTokens.length}`);
console.log(`  pinpoint:          ${pinpointTokens.length}`);
console.log(`  personio:          ${personioTokens.length}`);
console.log(`  total boards:      ${totalBoards}`);
console.log(`  yc:                on`);
console.log(`  weworkremotely:    on`);
console.log(`  adzuna:            ${Object.keys(adzunaSource).length > 0 ? 'enabled' : 'disabled'}`);
console.log(`  usajobs:           ${Object.keys(usajobsSource).length > 0 ? 'enabled' : 'disabled'}`);
console.log(`  jsearch:           ${Object.keys(jsearchSource).length > 0 ? 'enabled' : 'disabled'}`);
console.log(`  AI judger:         ${mode}`);
console.log('  Fetching jobs…');

const result = await runDigest(config);
const fetchMs = Date.now() - t0;

console.log('');
console.log('── source results ───');
for (const sr of result.sourceResults) {
  const status = sr.error ? `error=${sr.error.type}` : 'ok';
  console.log(`  ${sr.source.padEnd(11)} jobs=${String(sr.jobCount).padStart(4)}  ${String(sr.durationMs).padStart(5)}ms  ${status}`);
}

console.log('');
console.log(`── pipeline ranked top ${result.jobs.length} (${fetchMs}ms total) ───`);

if (judger === null) {
  console.log('  AI filter disabled. Top ranked:');
  for (const r of result.jobs.slice(0, 50)) {
    const score = r.score.toFixed(2).padStart(6);
    console.log(`  #${String(r.rank).padStart(3)} score=${score}  ${r.job.source}/${r.job.company} — ${r.job.title}`);
  }
  console.log('\n──────────────────────────────────────────────────────\n');
  process.exit(0);
}
console.log('  Running AI final filter…');

const aiT0 = Date.now();
const ai = await aiFilter(result.jobs, config.profile, judger, ['strong', 'solid']);
const aiMs = Date.now() - aiT0;

const rationaleById = new Map(ai.judgments.map((j) => [j.id, j.rationale]));
function fmt(tier: Tier, jobs: readonly RankedJob[]): void {
  console.log(`\n── tier: ${tier} (${jobs.length}) ───`);
  for (const r of jobs) {
    const why = rationaleById.get(r.job.id) ?? '';
    console.log(`  #${String(r.rank).padStart(2)} ${r.job.source}/${r.job.company} — ${r.job.title}`);
    if (why) console.log(`      ${why}`);
  }
}

console.log('');
console.log(`── AI filter done in ${aiMs}ms — survivors: ${ai.survivors.length}/${result.jobs.length} ───`);
fmt('strong', ai.tiered.strong);
fmt('solid', ai.tiered.solid);
fmt('borderline', ai.tiered.borderline);
fmt('drop', ai.tiered.dropped);
console.log('\n──────────────────────────────────────────────────────\n');
