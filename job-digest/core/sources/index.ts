/**
 * Source adapter registry. Agent A populates this file by re-exporting
 * the individual adapters in this directory and assembling them into
 * the {@link ALL_ADAPTERS} array consumed by the pipeline orchestrator.
 */
import type { SourceAdapter } from '../types/source.js';

/** Registry of all built-in adapters. Agent A populates. */
export const ALL_ADAPTERS: readonly SourceAdapter[] = [];
