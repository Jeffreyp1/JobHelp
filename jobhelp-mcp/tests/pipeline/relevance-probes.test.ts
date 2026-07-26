import { describe, expect, it } from 'vitest';
import { rank } from '../../core/pipeline/rank.js';
import { validateConfig } from '../../core/lib/config-validation.js';
import type { NormalizedJob } from '../../core/types/index.js';
import { lexicalEmbedder } from './helpers/lexical-embedder.js';

const NOW = new Date('2026-07-17T00:00:00Z');

function makeJob(
  id: string,
  title: string,
  description: string,
  company = 'acme',
): NormalizedJob {
  return {
    id,
    source: 'probe',
    url: `https://example.com/${id}`,
    title,
    company,
    location: 'Remote (US)',
    remote: 'remote',
    postedAt: '2026-07-16T00:00:00Z',
    description,
  };
}

// Profile mirrors the real user: entry-level, AI/backend/LLM focus.
const SKILLS = [
  'typescript', 'python', 'go', 'node.js', 'react', 'aws', 'lambda',
  'postgresql', 'redis', 'kafka', 'docker', 'llm', 'claude', 'rag',
  'agentic', 'multi-agent', 'backend', 'distributed', 'ai', 'engineer',
];

function config(overrides: Record<string, unknown>) {
  return validateConfig({
    profile: {
      resumeDumpPath: '/tmp/r.md',
      skills: SKILLS,
      location: 'Remote',
      remoteOk: true,
      salaryFloor: 1,
      seniority: 'entry',
      roleFamily: [],
    },
    ranking: { topN: 20, digestK: 20, ...overrides },
    output: { dir: '/tmp' },
  });
}

// 1 perfect match + 1 domain-right/seniority-wrong + 4 plausible decoys + 5 off-domain probes.
const PERFECT = makeJob(
  'PROBE-PERFECT',
  'AI Engineer - Agentic Systems, LLM Tooling & Backend',
  `AI Engineer building LLM-powered systems and multi-agent AI tooling. Agentic workflows and
   multi-agent orchestration with Claude, prompt engineering, RAG retrieval. Backend and distributed
   systems in TypeScript, Python, Go, Node.js; AWS Lambda; PostgreSQL, Redis, Kafka, Docker.
   Early-career and new-grad engineers welcome.`,
  'dreamco',
);
const PRINCIPAL = makeJob(
  'PROBE-PRINCIPAL',
  'Principal / Staff Distributed Systems Engineer (15+ years)',
  `Principal Staff Engineer with 15+ years leading distributed systems. Backend, Go, Kafka,
   PostgreSQL, Redis, AWS, LLM infrastructure and multi-agent AI platforms. Set technical strategy,
   mentor staff engineers, own architecture at massive scale. Senior leadership IC role.`,
  'megacorp',
);
const DECOYS = [
  makeJob('DECOY-1', 'Backend Engineer', 'Backend engineer in Go and PostgreSQL on AWS, Kafka, Redis, Docker.'),
  makeJob('DECOY-2', 'AI Engineer', 'AI engineer working with LLM, RAG, Python, and Claude for agentic backend services.'),
  makeJob('DECOY-3', 'Full Stack Engineer', 'Full stack engineer with TypeScript, React, Node.js and PostgreSQL.'),
  makeJob('DECOY-4', 'Platform Engineer', 'Platform engineer building distributed backend systems with Docker, AWS and Redis.'),
];
const JUNK = [
  makeJob('PROBE-NURSE', 'Registered Nurse - ICU', 'ICU nurse providing patient care, medications, vital signs. BSN and RN license, BLS ACLS.', 'hospital'),
  makeJob('PROBE-DIESEL', 'Diesel Mechanic', 'Repair diesel engines, hydraulics and heavy trucks. Preventive maintenance, CDL required.', 'fleet'),
  makeJob('PROBE-SALES', 'Enterprise Sales Account Executive', 'Own a quota, cold call prospects, negotiate contracts, close deals in Salesforce CRM.', 'salesco'),
  makeJob('PROBE-CFO', 'Chief Financial Officer', 'Lead financial operations, GAAP accounting, treasury, investor relations. CPA MBA, 15+ years.', 'holdings'),
  makeJob('PROBE-BARISTA', 'Barista', 'Prepare espresso drinks, operate the register, restock, friendly customer service. No experience needed.', 'cafe'),
];
const POOL = [PERFECT, PRINCIPAL, ...DECOYS, ...JUNK];
const N = POOL.length;
const JUNK_IDS = JUNK.map((j) => j.id);

async function rankWith(mode: 'blend' | 'rrf', seniorityPenalty: boolean) {
  const ranked = await rank(
    POOL,
    config({
      fusion: { enabled: true, k: 60, mode, seniorityPenalty },
      semantic: { enabled: true },
    }),
    undefined,
    NOW,
    { embedder: lexicalEmbedder() },
  );
  return new Map(ranked.map((r) => [r.job.id, r]));
}

const rankBlend = (seniorityPenalty: boolean) => rankWith('blend', seniorityPenalty);

describe('relevance probes (blend mode)', () => {
  it('ranks the perfect-match probe #1', async () => {
    const byId = await rankBlend(true);
    expect(byId.get('PROBE-PERFECT')?.rank).toBe(1);
  });

  it('never lets an off-domain probe outrank a genuine match', async () => {
    const byId = await rankBlend(true);
    // The genuine matches: the perfect probe + the plausible software decoys
    // (PRINCIPAL is excluded — it is the deliberately-demoted over-leveled role).
    const genuineIds = ['PROBE-PERFECT', 'DECOY-1', 'DECOY-2', 'DECOY-3', 'DECOY-4'];
    const worstGenuine = Math.max(...genuineIds.map((id) => byId.get(id)?.rank ?? 0));
    for (const id of JUNK_IDS) {
      const rankOf = byId.get(id)?.rank ?? 0;
      expect(rankOf, `${id} must rank below every genuine match`).toBeGreaterThan(worstGenuine);
    }
    // And all five off-domain probes occupy the bottom five slots.
    for (const id of JUNK_IDS) {
      expect(byId.get(id)?.rank ?? 0).toBeGreaterThan(N - JUNK_IDS.length);
    }
  });

  it('demotes the over-leveled (Principal, 15+ yr) probe via the seniority penalty', async () => {
    const withPenalty = await rankBlend(true);
    const withoutPenalty = await rankBlend(false);
    const on = withPenalty.get('PROBE-PRINCIPAL')?.rank ?? 0;
    const off = withoutPenalty.get('PROBE-PRINCIPAL')?.rank ?? 0;
    // The penalty must push the Principal role strictly further down.
    expect(on).toBeGreaterThan(off);
    // And it must not out-rank the perfect entry-level match.
    expect(on).toBeGreaterThan(1);
    expect(withPenalty.get('PROBE-PRINCIPAL')?.breakdown.seniorityPenalty).toBeLessThan(1);
  });

  it('applies the seniority penalty in rrf mode too', async () => {
    const withPenalty = await rankWith('rrf', true);
    const withoutPenalty = await rankWith('rrf', false);
    const on = withPenalty.get('PROBE-PRINCIPAL')?.rank ?? 0;
    const off = withoutPenalty.get('PROBE-PRINCIPAL')?.rank ?? 0;
    expect(on).toBeGreaterThan(off);
    expect(withPenalty.get('PROBE-PRINCIPAL')?.breakdown.seniorityPenalty).toBeLessThan(1);
    // score = raw rrf x penalty, and the raw rrf stays recorded for explainability
    const principal = withPenalty.get('PROBE-PRINCIPAL');
    expect(principal?.score).toBeCloseTo(
      (principal?.breakdown.rrf ?? 0) * (principal?.breakdown.seniorityPenalty ?? 1),
      10,
    );
    // level-appropriate jobs are untouched
    expect(withPenalty.get('PROBE-PERFECT')?.breakdown.seniorityPenalty).toBe(1);
  });

  it('rrf mode with penalty off leaves scores as raw rrf', async () => {
    const ranked = await rankWith('rrf', false);
    const perfect = ranked.get('PROBE-PERFECT');
    expect(perfect?.breakdown.seniorityPenalty).toBeUndefined();
    expect(perfect?.score).toBeCloseTo(perfect?.breakdown.rrf ?? -1, 10);
  });

  it('populates the blend breakdown fields', async () => {
    const byId = await rankBlend(true);
    const perfect = byId.get('PROBE-PERFECT');
    expect(typeof perfect?.breakdown.blend).toBe('number');
    expect(perfect?.breakdown.semantic).toBeGreaterThan(0);
    // An unpenalized entry-level match keeps penalty 1.0.
    expect(perfect?.breakdown.seniorityPenalty).toBe(1);
  });
});
