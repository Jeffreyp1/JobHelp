/**
 * First-run seeding: copy default rule files from GitHub raw URLs into the user's Drive.
 * Re-exports seedDefaults from drive.ts for convenience and to satisfy the module boundary
 * described in the design spec (extension-app/appsscript/src/seed.ts → seedDefaults).
 */

import { driveOps } from './drive.js';

export { driveOps };

/**
 * Convenience wrapper: seed the rules folder from the canonical GitHub raw base URL.
 *
 * @param rulesFolderId - Drive folder ID to write rule files into
 * @param rawBaseUrl    - Base URL for raw file fetches (e.g. GitHub raw content URL)
 * @param filenames     - List of filenames to seed
 */
export function seedDefaults(
  rulesFolderId: string,
  rawBaseUrl: string,
  filenames: string[],
): { seeded: string[]; errors: { filename: string; reason: string }[] } {
  return driveOps.seedDefaults(rulesFolderId, rawBaseUrl, filenames);
}
