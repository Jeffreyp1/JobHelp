import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runDigest } from '../core/digest/generate.js';
import type { JobDigestConfig } from '../core/types/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const companyListsDir = join(__dirname, '..', 'company-lists');

function loadSlugs(file: string, take?: number): readonly string[] {
  const p = join(companyListsDir, file);
  if (!existsSync(p)) return [];
  const all = JSON.parse(readFileSync(p, 'utf8')) as readonly string[];
  return take === undefined ? all : all.slice(0, take);
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

const ghTake = envInt('JOBHELP_BENCH_GH', 400);
const ashbyTake = envInt('JOBHELP_BENCH_ASHBY', 200);

const greenhouseTokens = loadSlugs('greenhouse.json', ghTake);
const ashbyTokens = loadSlugs('ashby.json', ashbyTake);
const leverSlugs = loadSlugs('lever.json');
const smartrecruitersTokens = loadSlugs('smartrecruiters.json');
const recruiteeTokens = loadSlugs('recruitee.json');
const teamtailorTokens = loadSlugs('teamtailor.json');
const breezyTokens = loadSlugs('breezy.json');
const pinpointTokens = loadSlugs('pinpoint.json');
const personioTokens = loadSlugs('personio.json');

const config: JobDigestConfig = {
  profile: {
    resumeDumpPath: '/tmp/resume.md',
    skills: [
      'typescript', 'javascript', 'python', 'node', 'react',
      'backend', 'frontend', 'fullstack', 'distributed systems',
      'kubernetes', 'aws', 'postgres',
    ],
    location: 'Austin, TX',
    remoteOk: true,
    salaryFloor: 100000,
    seniority: 'mid',
    roleFamily: ['backend', 'fullstack', 'frontend'],
  },
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
  },
  ranking: { topN: 200, digestK: 50 },
  rules: { userRulesDir: '/tmp/rules-bench', mode: 'additive' },
  output: { dir: '/tmp/jobhelp-bench' },
};

const totalBoards =
  greenhouseTokens.length + ashbyTokens.length + leverSlugs.length +
  smartrecruitersTokens.length + recruiteeTokens.length + teamtailorTokens.length +
  breezyTokens.length + pinpointTokens.length + personioTokens.length;

console.log(`bench-retrieval: ${totalBoards} boards (gh=${greenhouseTokens.length} ashby=${ashbyTokens.length}) + 4 aggregator sources`);
console.log(`cache=${process.env['JOBHELP_HTTP_CACHE'] ?? '(default)'} dir=${process.env['JOBHELP_HTTP_CACHE_DIR'] ?? '(default)'}`);

const t0 = Date.now();
const result = await runDigest(config);
const totalMs = Date.now() - t0;

let errors = 0;
for (const sr of result.sourceResults) {
  const status = sr.error ? `error=${sr.error.type}` : 'ok';
  if (sr.error) errors += 1;
  console.log(`  ${sr.source.padEnd(16)} jobs=${String(sr.jobCount).padStart(5)}  ${String(sr.durationMs).padStart(6)}ms  ${status}`);
}
console.log(`TOTAL ${totalMs}ms  ranked=${result.jobs.length}  sourceErrors=${errors}`);
