import { isPlainObject } from './config-validation-primitives.js';

const ENV_RE = /\$\{([A-Z_][A-Z0-9_]*)\}/gi;

function interpolateEnvString(s: string): string {
  return s.replace(ENV_RE, (_match, name: string) => process.env[name] ?? '');
}

export function interpolateEnv(value: unknown): unknown {
  if (typeof value === 'string') return interpolateEnvString(value);
  if (Array.isArray(value)) return value.map(interpolateEnv);
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = interpolateEnv(v);
    }
    return out;
  }
  return value;
}
