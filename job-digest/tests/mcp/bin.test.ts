import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bootstrap } from '../../mcp/src/wiring.js';
import { buildServer } from '../../mcp/src/index.js';
import {
  RECENT_DIGEST_URI,
  RESUME_URI,
  RULES_DEFAULTS_URI,
  RULES_MERGED_URI,
  RULES_USER_URI,
  STATE_URI,
} from '../../mcp/src/resources.js';

const EXPECTED_TOOL_NAMES = [
  'init_config',
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

  it('all 13 tool keys present on CoreDeps', async () => {
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

  it('buildServer accepts wired deps and exposes 13 tools + 6 resources', async () => {
    const { coreDeps, resourceDeps } = await bootstrap();
    const handle = buildServer({ coreDeps, resourceDeps });
    expect(handle.tools.length).toBe(13);
    expect(handle.resources.length).toBe(6);
    const toolNames = handle.tools.map((t) => t.definition.name).sort();
    expect(toolNames).toEqual([...EXPECTED_TOOL_NAMES].sort());
    const resourceUris = handle.resources.map((r) => r.descriptor.uri).sort();
    expect(resourceUris).toEqual(
      [
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
