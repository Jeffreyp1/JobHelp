import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { rank } from '../core/pipeline/rank.js';
import { validateConfig } from '../core/lib/config-validation.js';
import { getDefaultEmbedder } from '../core/pipeline/embed.js';
import { DEFAULT_RERANK_MODEL, getDefaultReranker } from '../core/pipeline/rerank.js';
import type { JobDigestConfig, NormalizedJob, RankedJob } from '../core/types/index.js';
import {
  hardViolations,
  pairwiseAccuracy,
  spearman,
  type TierRankRow,
} from '../tests/pipeline/helpers/rank-metrics.js';

// The user's live embedder; overridable with --embed-model. Reranker default mirrors rerank.ts.
const DEFAULT_EMBED_MODEL = 'Xenova/bge-base-en-v1.5';
const RERANK_TOP_K = 50;

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, '..', 'tests', 'fixtures');

// Same profile the two benchmark tests inject, so the real-model run is directly comparable.
const SKILLS = [
  'typescript', 'python', 'go', 'node.js', 'react', 'aws', 'lambda',
  'postgresql', 'redis', 'kafka', 'docker', 'llm', 'claude', 'rag',
  'agentic', 'multi-agent', 'backend', 'distributed', 'ai', 'engineer',
];

interface Probe {
  readonly id: string;
  readonly finalTier: number;
  readonly title: string;
  readonly company: string;
  readonly description: string;
  readonly split?: 'dev' | 'holdout';
}

// Floors mirrored verbatim from the two benchmark tests (see relevance-benchmark*.test.ts).
interface Floors {
  readonly rho: number;
  readonly pairwise: number;
  readonly t5Ceiling: number; // max T5-above-T1/T2 hard violations (T4 excluded)
  readonly allCeiling: number; // max total (T4+T5)-above-T1/T2 hard violations
}

interface FixtureSet {
  readonly name: string;
  readonly now: Date;
  readonly postedAt: string;
  readonly probes: readonly Probe[];
  readonly floors: Floors;
}

interface RunResult {
  readonly rho: number;
  readonly pairwise: number;
  readonly t5: number;
  readonly all: number;
  readonly pass: boolean;
}

interface Args {
  readonly embedModel: string;
  readonly rerankModel: string;
  readonly limit?: number;
}

function loadProbes(file: string): readonly Probe[] {
  return JSON.parse(readFileSync(join(fixturesDir, file), 'utf8')) as readonly Probe[];
}

function buildConfig(embedModel: string, rerankOn: boolean, rerankModel: string): JobDigestConfig {
  return validateConfig({
    profile: {
      resumeDumpPath: '/tmp/r.md',
      skills: SKILLS,
      location: 'Remote',
      remoteOk: true,
      salaryFloor: 1,
      seniority: 'entry',
      roleFamily: ['ml', 'backend', 'fullstack', 'devops'],
    },
    ranking: {
      topN: 20,
      digestK: 20,
      fusion: { enabled: true, k: 60, mode: 'rrf', seniorityPenalty: true },
      semantic: { enabled: true, model: embedModel },
      ...(rerankOn ? { rerank: { enabled: true, topK: RERANK_TOP_K, model: rerankModel } } : {}),
    },
    output: { dir: '/tmp' },
  });
}

function toJobs(set: FixtureSet): readonly NormalizedJob[] {
  return set.probes.map((p) => ({
    id: p.id,
    source: 'probe',
    url: `https://example.com/${p.id}`,
    title: p.title,
    company: p.company,
    location: 'Remote (US)',
    remote: 'remote',
    postedAt: set.postedAt,
    description: p.description,
  }));
}

function toRows(set: FixtureSet, ranked: readonly RankedJob[]): readonly TierRankRow[] {
  const tierOf = new Map(set.probes.map((p) => [p.id, p.finalTier]));
  return ranked.map((r) => {
    const tier = tierOf.get(r.job.id);
    if (tier === undefined) throw new Error(`unlabeled probe in output: ${r.job.id}`);
    return { id: r.job.id, tier, rank: r.rank };
  });
}

function evaluate(rows: readonly TierRankRow[], f: Floors): RunResult {
  const rho = spearman(rows);
  const pairwise = pairwiseAccuracy(rows);
  // Mirrors the live tests: T5-above-T1/T2 is a hard zero; total violations bound T4 drift.
  const t5 = hardViolations(rows.filter((r) => r.tier !== 4)).length;
  const all = hardViolations(rows).length;
  const pass = rho >= f.rho && pairwise >= f.pairwise && t5 <= f.t5Ceiling && all <= f.allCeiling;
  return { rho, pairwise, t5, all, pass };
}

function parseArgs(argv: readonly string[]): Args {
  let embedModel = DEFAULT_EMBED_MODEL;
  let rerankModel = DEFAULT_RERANK_MODEL;
  let limit: number | undefined;
  const wantsValue = (k: string): boolean =>
    k === '--embed-model' || k === '--rerank-model' || k === '--limit';
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? '';
    if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    }
    if (!arg.startsWith('--')) continue;
    const eq = arg.indexOf('=');
    const key = eq >= 0 ? arg.slice(0, eq) : arg;
    let value: string | undefined = eq >= 0 ? arg.slice(eq + 1) : undefined;
    if (value === undefined && wantsValue(key)) value = argv[++i];
    if (key === '--embed-model' && value !== undefined) embedModel = value;
    else if (key === '--rerank-model' && value !== undefined) rerankModel = value;
    else if (key === '--limit' && value !== undefined) limit = Math.max(1, Math.floor(Number(value)));
    else if (!wantsValue(key)) {
      console.error(`unknown flag: ${key}`);
      process.exit(2);
    }
  }
  return { embedModel, rerankModel, ...(limit !== undefined ? { limit } : {}) };
}

function printUsage(): void {
  console.log(
    [
      'Usage: npm run bench:real -- [options]',
      '',
      'Real-model relevance benchmark. Runs the same probes/metrics as the two',
      'benchmark tests, but with the live embedder and (optionally) the cross-encoder',
      'reranker, to gate enabling ranking.rerank.',
      '',
      'Options:',
      '  --embed-model <id>   embedder model id (default Xenova/bge-base-en-v1.5)',
      `  --rerank-model <id>  reranker model id (default ${DEFAULT_RERANK_MODEL})`,
      '  --limit <n>          cap probes per fixture set (SMOKE only, non-authoritative)',
      '  -h, --help           show this help',
    ].join('\n'),
  );
}

const HEADER =
  'set'.padEnd(13) +
  'rerank'.padEnd(8) +
  'spearman'.padEnd(16) +
  'pairwise'.padEnd(16) +
  't5>hi'.padEnd(8) +
  'all-viol'.padEnd(11) +
  'result';

function formatRow(set: FixtureSet, rerankOn: boolean, r: RunResult): string {
  return (
    set.name.padEnd(13) +
    (rerankOn ? 'ON' : 'OFF').padEnd(8) +
    `${r.rho.toFixed(3)}/${set.floors.rho.toFixed(2)}`.padEnd(16) +
    `${r.pairwise.toFixed(3)}/${set.floors.pairwise.toFixed(2)}`.padEnd(16) +
    `${r.t5}/${set.floors.t5Ceiling}`.padEnd(8) +
    `${r.all}/${set.floors.allCeiling}`.padEnd(11) +
    (r.pass ? 'PASS' : 'FAIL')
  );
}

async function main(): Promise<void> {
  const { embedModel, rerankModel, limit } = parseArgs(process.argv.slice(2));

  const probes20 = loadProbes('relevance-probes.json');
  const probesLive = loadProbes('relevance-probes-live.json');
  const nowLive = new Date('2026-07-19T00:00:00Z');
  const clip = (ps: readonly Probe[]): readonly Probe[] => (limit === undefined ? ps : ps.slice(0, limit));

  const sets: readonly FixtureSet[] = [
    {
      name: '20-probe',
      now: new Date('2026-07-17T00:00:00Z'),
      postedAt: '2026-07-16T00:00:00Z',
      probes: clip(probes20),
      floors: { rho: 0.77, pairwise: 0.81, t5Ceiling: 0, allCeiling: 0 },
    },
    {
      name: 'live-dev',
      now: nowLive,
      postedAt: '2026-07-18T00:00:00Z',
      probes: clip(probesLive.filter((p) => p.split === 'dev')),
      floors: { rho: 0.7, pairwise: 0.79, t5Ceiling: 0, allCeiling: 14 },
    },
    {
      name: 'live-holdout',
      now: nowLive,
      postedAt: '2026-07-18T00:00:00Z',
      probes: clip(probesLive.filter((p) => p.split === 'holdout')),
      floors: { rho: 0.73, pairwise: 0.81, t5Ceiling: 0, allCeiling: 10 },
    },
  ];

  console.log('──────────────────────────────────────────────────────────────');
  console.log('JobHelp real-model relevance benchmark');
  console.log(`  embedder: ${embedModel}`);
  console.log(`  reranker: ${rerankModel} (topK ${RERANK_TOP_K})`);
  if (limit !== undefined) console.log(`  limit:    ${limit} probes/set (SMOKE — not authoritative)`);
  console.log('──────────────────────────────────────────────────────────────');

  console.log(`loading embedder ${embedModel} ...`);
  await getDefaultEmbedder(embedModel);
  console.log(`loading reranker ${rerankModel} ...`);
  const reranker = await getDefaultReranker(rerankModel);
  console.log('models ready.\n');

  console.log('measured/floor per cell; PASS needs rho>=floor, pairwise>=floor, viols<=ceiling');
  console.log(HEADER);

  let holdoutRerankOn: RunResult | undefined;
  for (const set of sets) {
    for (const rerankOn of [false, true]) {
      const config = buildConfig(embedModel, rerankOn, rerankModel);
      const deps = rerankOn ? { reranker } : undefined;
      const ranked = await rank(toJobs(set), config, undefined, set.now, deps);
      if (rerankOn && !ranked.some((r) => r.breakdown.rerank !== undefined)) {
        throw new Error(
          `rerank ON but no cross-encoder scores landed for ${set.name}: the reranker failed to score (applyRerank degraded silently)`,
        );
      }
      const result = evaluate(toRows(set, ranked), set.floors);
      if (set.name === 'live-holdout' && rerankOn) holdoutRerankOn = result;
      console.log(formatRow(set, rerankOn, result));
    }
  }

  console.log('\n──────────────────────────────────────────────────────────────');
  console.log('Gate: live-holdout floors must all pass with rerank ON.');
  const authoritative = limit === undefined;
  if (authoritative && holdoutRerankOn?.pass === true) {
    console.log('RERANK ENABLE: SAFE');
    process.exitCode = 0;
  } else if (!authoritative) {
    console.log('RERANK ENABLE: NOT VALIDATED (--limit smoke run is not authoritative)');
    process.exitCode = 1;
  } else {
    console.log('RERANK ENABLE: NOT VALIDATED');
    process.exitCode = 1;
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.stack ?? e.message : String(e));
  process.exit(1);
});
