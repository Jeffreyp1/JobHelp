import type { Ats } from './types.ts';
import { greenhouse } from './greenhouse.ts';
import { lever } from './lever.ts';
import { ashby } from './ashby.ts';
import { workable } from './workable.ts';
import { smartRecruiters } from './smartrecruiters.ts';
import { recruitee } from './recruitee.ts';

const ADAPTERS: readonly Ats[] = [greenhouse, lever, ashby, workable, smartRecruiters, recruitee];

export function pickAts(url: string): Ats | null {
  return ADAPTERS.find((a) => a.matches(url)) ?? null;
}
