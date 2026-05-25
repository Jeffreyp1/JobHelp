import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootstrap } from '../../mcp/src/wiring.js';
import { buildServer } from '../../mcp/src/index.js';
import { loadPackageMeta } from '../../mcp/src/bin.js';
import {
  PROMPT_TAILOR_RESUME_URI,
  PROMPT_TAILOR_RESUMES_URI,
  PROMPT_VALIDATE_RESUME_URI,
  RECENT_DIGEST_URI,
  RESUME_URI,
  RULES_DEFAULTS_URI,
  RULES_MERGED_URI,
  RULES_USER_URI,
  STATE_URI,
} from '../../mcp/src/resources.js';

const EXPECTED_TOOL_NAMES = [
  'init_config',
  'apply_config_answers',
  'register_resume',
  'set_active_resume',
  'find_matching_jobs',
  'get_latest_digest',
  'get_job',
  'read_rules',
  'read_resume',
  'score_keyword_match',
  'start_application',
  'write_application_output',
  'list_application_versions',
  'list_recent_applications',
  'validate_sources',
  'rerank_top_jobs',
] as const;

function writeMinimalConfig(dir: string): string {
  const configDir = join(dir, '.config', 'jobhelp');
  mkdirSync(configDir, { recursive: true });
  const p = join(configDir, 'config.json');
  writeFileSync(
    p,
    JSON.stringify({
      profile: {
        resumeDumpPath: join(dir, 'resume.md'),
        skills: ['typescript'],
        location: 'Remote',
        remoteOk: true,
        salaryFloor: 100000,
        seniority: 'mid',
        roleFamily: ['backend'],
      },
      ranking: { topN: 5, digestK: 5 },
      output: { dir: join(dir, 'digests') },
      rules: { mode: 'additive', userRulesDir: join(dir, 'rules') },
    }),
  );
  return p;
}

describe('bootstrap (uninitialized — config missing)', () => {
  let tmp: string;
  let prevHome: string | undefined;
  let prevConfigPath: string | undefined;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'jobhelp-bootstrap-uninit-'));
    prevHome = process.env['JOBHELP_HOME'];
    prevConfigPath = process.env['JOBHELP_CONFIG_PATH'];
    process.env['JOBHELP_HOME'] = tmp;
    process.env['JOBHELP_CONFIG_PATH'] = join(tmp, 'does-not-exist.json');
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env['JOBHELP_HOME'];
    else process.env['JOBHELP_HOME'] = prevHome;
    if (prevConfigPath === undefined) delete process.env['JOBHELP_CONFIG_PATH'];
    else process.env['JOBHELP_CONFIG_PATH'] = prevConfigPath;
    rmSync(tmp, { recursive: true, force: true });
  });

  it('returns uninitialized deps when config not_found', async () => {
    const { coreDeps, resourceDeps } = await bootstrap();
    expect(typeof coreDeps.initConfig).toBe('function');
    expect(typeof resourceDeps.readRulesDefaults).toBe('function');
  });

  it('uninitialized initConfig still returns ask_user prompts', async () => {
    const { coreDeps } = await bootstrap();
    const r = await coreDeps.initConfig({ interactive: true });
    expect(r.ok).toBe(true);
  });

  it('uninitialized non-init tools return not_configured', async () => {
    const { coreDeps } = await bootstrap();
    const r = await coreDeps.registerResume({ name: 'r', content: '# x' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.type).toBe('not_configured');
  });

  it('uninitialized resources return not_configured', async () => {
    const { resourceDeps } = await bootstrap();
    const r = await resourceDeps.readRulesDefaults();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.type).toBe('not_configured');
  });
});

describe('bootstrap (wired) — surface', () => {
  let tmp: string;
  let prevHome: string | undefined;
  let prevConfigPath: string | undefined;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'jobhelp-bootstrap-wired-'));
    prevHome = process.env['JOBHELP_HOME'];
    prevConfigPath = process.env['JOBHELP_CONFIG_PATH'];
    process.env['JOBHELP_HOME'] = tmp;
    process.env['JOBHELP_CONFIG_PATH'] = writeMinimalConfig(tmp);
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env['JOBHELP_HOME'];
    else process.env['JOBHELP_HOME'] = prevHome;
    if (prevConfigPath === undefined) delete process.env['JOBHELP_CONFIG_PATH'];
    else process.env['JOBHELP_CONFIG_PATH'] = prevConfigPath;
    rmSync(tmp, { recursive: true, force: true });
  });

  it('returns wired deps when config loads', async () => {
    const { coreDeps, resourceDeps } = await bootstrap();
    expect(coreDeps).toBeDefined();
    expect(resourceDeps).toBeDefined();
  });

  it('all wired tool keys present on CoreDeps', async () => {
    const { coreDeps } = await bootstrap();
    for (const name of EXPECTED_TOOL_NAMES) {
      const key = name.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()) as keyof typeof coreDeps;
      expect(typeof coreDeps[key]).toBe('function');
    }
  });

  it('all 6 resource keys present on ResourceDeps', async () => {
    const { resourceDeps } = await bootstrap();
    expect(typeof resourceDeps.readRulesDefaults).toBe('function');
    expect(typeof resourceDeps.readRulesUser).toBe('function');
    expect(typeof resourceDeps.readRulesMerged).toBe('function');
    expect(typeof resourceDeps.readActiveResume).toBe('function');
    expect(typeof resourceDeps.readRecentDigest).toBe('function');
    expect(typeof resourceDeps.readState).toBe('function');
  });

  it('buildServer accepts wired deps and exposes 18 tools + 9 resources + 3 prompts', async () => {
    const { coreDeps, resourceDeps } = await bootstrap();
    const handle = buildServer({ coreDeps, resourceDeps });
    expect(handle.tools.length).toBe(18);
    expect(handle.resources.length).toBe(9);
    expect(handle.prompts.length).toBe(3);
    const toolNames = handle.tools.map((t) => t.definition.name).sort();
    expect(toolNames).toEqual(
      [...EXPECTED_TOOL_NAMES, 'apply_scoped_resume_edits', 'get_resume_outline'].sort(),
    );
    const resourceUris = handle.resources.map((r) => r.descriptor.uri).sort();
    expect(resourceUris).toEqual(
      [
        PROMPT_TAILOR_RESUME_URI,
        PROMPT_TAILOR_RESUMES_URI,
        PROMPT_VALIDATE_RESUME_URI,
        RECENT_DIGEST_URI,
        RESUME_URI,
        RULES_DEFAULTS_URI,
        RULES_MERGED_URI,
        RULES_USER_URI,
        STATE_URI,
      ].sort(),
    );
  });

  it('wired handlers are not the original stub: registerResume actually persists', async () => {
    const { coreDeps } = await bootstrap();
    const r = await coreDeps.registerResume({ name: 'wired', content: '# wired resume\n' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.name).toBe('wired');
      expect(r.value.storedAt).toContain('wired.md');
    }
  });
});

describe('loadPackageMeta', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const pkgPath = join(here, '..', '..', 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { name: string; version: string };

  it('returns the version from the published package.json', () => {
    const meta = loadPackageMeta();
    expect(meta.version).toBe(pkg.version);
  });

  it('returns a short server name (not the scoped npm name)', () => {
    const meta = loadPackageMeta();
    expect(meta.name).toBe('jobhelp-mcp');
  });

  it('does not return the stale 0.2.0-alpha.0 default', () => {
    const meta = loadPackageMeta();
    expect(meta.version).not.toBe('0.2.0-alpha.0');
  });
});
