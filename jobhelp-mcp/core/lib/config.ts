import { readFile } from 'node:fs/promises';
import type { JobDigestConfig, SourcesConfig } from '../types/config.js';
import { loadCompanySourcesForConfig } from '../init/companySources.js';
import { err, ok, type Result } from '../types/result.js';
import { interpolateEnv } from './config-env.js';
import { expandHome } from './config-path.js';
import { validateConfig } from './config-validation.js';

export { interpolateEnv };
export type { RulesMode, RulesConfig } from '../types/config.js';

export interface ConfigError {
  readonly type: 'not_found' | 'parse' | 'validation';
  readonly message: string;
  readonly path?: string;
}

function mergeCompanySources(
  config: JobDigestConfig,
  sources: SourcesConfig | undefined,
): JobDigestConfig {
  if (sources === undefined) return config;
  return {
    ...config,
    sources: {
      ...config.sources,
      ...sources,
    },
  };
}

function getStringCode(e: unknown): string | undefined {
  if (typeof e !== 'object' || e === null) return undefined;
  const c = Reflect.get(e, 'code');
  return typeof c === 'string' ? c : undefined;
}

export async function loadConfig(
  path: string,
): Promise<Result<JobDigestConfig, ConfigError>> {
  const resolved = expandHome(path);
  let raw: string;
  try {
    raw = await readFile(resolved, 'utf8');
  } catch (e: unknown) {
    if (getStringCode(e) === 'ENOENT') {
      return err({
        type: 'not_found',
        path: resolved,
        message: `config file not found: ${resolved}`,
      });
    }
    const message = e instanceof Error ? e.message : 'unknown read error';
    return err({ type: 'not_found', path: resolved, message });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'unknown parse error';
    return err({ type: 'parse', path: resolved, message: `failed to parse JSON: ${message}` });
  }

  const interpolated = interpolateEnv(parsed);

  try {
    const config = validateConfig(interpolated);
    const companySources = await loadCompanySourcesForConfig(resolved);
    return ok(mergeCompanySources(config, companySources));
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'unknown validation error';
    return err({ type: 'validation', path: resolved, message });
  }
}
