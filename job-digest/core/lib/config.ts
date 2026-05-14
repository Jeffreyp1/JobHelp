import type { JobDigestConfig } from '../types/config.js';
import { err, type Result } from '../types/result.js';

export interface ConfigError {
  readonly type: 'not_found' | 'parse' | 'validation';
  readonly message: string;
  readonly path?: string;
}

/**
 * Load and validate the user config from disk.
 *
 * @param path - filesystem path to config.json (supports `~` expansion and `${ENV}` interpolation)
 * @returns Result with the parsed config or a typed ConfigError
 */
export async function loadConfig(
  path: string,
): Promise<Result<JobDigestConfig, ConfigError>> {
  // STUB body — Agent D owns the real implementation.
  void path;
  return err({
    type: 'not_found',
    message: 'loadConfig() not implemented — Agent D owns core/lib/config.ts',
  });
}
