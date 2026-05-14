/**
 * Source adapter registry. Wires the per-source modules into the
 * {@link ALL_ADAPTERS} array consumed by the pipeline orchestrator.
 * Adding a new source: add a new file in this directory and register it here.
 */
import type { SourceAdapter } from '../types/source.js';
import { adzuna } from './adzuna.js';
import { greenhouse } from './greenhouse.js';
import { lever } from './lever.js';

/** Registry of all built-in adapters. */
export const ALL_ADAPTERS: readonly SourceAdapter[] = [adzuna, greenhouse, lever] as const;

export { adzuna, greenhouse, lever };
