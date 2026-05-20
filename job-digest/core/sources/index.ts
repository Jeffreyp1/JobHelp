/**
 * Source adapter registry. Wires the per-source modules into the
 * {@link ALL_ADAPTERS} array consumed by the pipeline orchestrator.
 * Adding a new source: add a new file in this directory and register it here.
 */
import type { SourceAdapter } from '../types/source.js';
import { adzuna } from './adzuna.js';
import { ashby } from './ashby.js';
import { breezy } from './breezy.js';
import { greenhouse } from './greenhouse.js';
import { jsearch } from './jsearch.js';
import { lever } from './lever.js';
import { personio } from './personio.js';
import { pinpoint } from './pinpoint.js';
import { recruitee } from './recruitee.js';
import { remoteok } from './remoteok.js';
import { remotive } from './remotive.js';
import { smartrecruiters } from './smartrecruiters.js';
import { teamtailor } from './teamtailor.js';
import { usajobs } from './usajobs.js';
import { weworkremotely } from './weworkremotely.js';
import { workable } from './workable.js';
import { yc } from './yc.js';

/** Registry of all built-in adapters. */
export const ALL_ADAPTERS: readonly SourceAdapter[] = [
  adzuna,
  ashby,
  breezy,
  greenhouse,
  jsearch,
  lever,
  personio,
  pinpoint,
  recruitee,
  remoteok,
  remotive,
  smartrecruiters,
  teamtailor,
  usajobs,
  weworkremotely,
  workable,
  yc,
] as const;

export {
  adzuna,
  ashby,
  breezy,
  greenhouse,
  jsearch,
  lever,
  personio,
  pinpoint,
  recruitee,
  remoteok,
  remotive,
  smartrecruiters,
  teamtailor,
  usajobs,
  weworkremotely,
  workable,
  yc,
};
