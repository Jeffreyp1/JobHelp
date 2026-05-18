import { createHash } from 'node:crypto';

export interface FetchResult {
  status: number;
  body: string;
}

export interface GateResult {
  accepted: boolean;
  reason?: string;
}

const MIN_LENGTH = 500;

const LOGIN_WALL_MARKERS = [
  /sign in to view/i,
  /join linkedin/i,
  /create your free account/i,
  /please log in to continue/i,
];

const ANTI_BOT_MARKERS = [
  /access denied/i,
  /captcha/i,
  /cloudflare|please verify you are human/i,
  /403\s+forbidden/i,
];

export function gateContent(r: FetchResult): GateResult {
  if (r.status === 403) return { accepted: false, reason: 'HTTP 403 (likely anti-bot)' };
  if (r.status < 200 || r.status >= 300) return { accepted: false, reason: `HTTP ${r.status}` };
  if (r.body.length < MIN_LENGTH) return { accepted: false, reason: `Body too short (${r.body.length} chars; min ${MIN_LENGTH})` };
  for (const m of LOGIN_WALL_MARKERS) {
    if (m.test(r.body)) return { accepted: false, reason: `Login wall detected (${m.source})` };
  }
  for (const m of ANTI_BOT_MARKERS) {
    if (m.test(r.body)) return { accepted: false, reason: `Anti-bot/captcha marker detected (${m.source})` };
  }
  return { accepted: true };
}

export function deriveJobIdFromUrl(url: string): string {
  const hash = createHash('sha256').update(url).digest('hex').slice(0, 12);
  return `url-${hash}`;
}
