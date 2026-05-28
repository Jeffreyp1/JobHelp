import type { ResearchCompanyResult } from '../types/api-contract.js';
import { log } from '../lib/structuredLog.js';

declare const CacheService: {
  getScriptCache(): {
    get(key: string): string | null;
    put(key: string, value: string, ttlSeconds?: number): void;
  };
};

const CACHE_TTL_SECONDS = 86400;

export interface CachedResearchPayload {
  summary: string;
  keywords: string[];
  sources: { title: string; url: string }[];
  cost: ResearchCompanyResult['cost'];
}

export function readCache(key: string): CachedResearchPayload | null {
  try {
    if (typeof CacheService === 'undefined') return null;
    const raw = CacheService.getScriptCache().get(key);
    if (!raw) return null;
    return JSON.parse(raw) as CachedResearchPayload;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log('warn', 'research cache read failed', { key, error: message });
    return null;
  }
}

export function writeCache(key: string, payload: CachedResearchPayload): void {
  try {
    if (typeof CacheService === 'undefined') return;
    CacheService.getScriptCache().put(key, JSON.stringify(payload), CACHE_TTL_SECONDS);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log('warn', 'research cache write failed', { key, error: message });
  }
}
