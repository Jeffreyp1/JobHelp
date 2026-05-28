export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export function fail(message: string): never {
  throw new ValidationError(message);
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function requireRecord(v: unknown, field: string): Record<string, unknown> {
  if (!isPlainObject(v)) fail(`expected object at field ${field}`);
  return v;
}

export function requireString(v: unknown, field: string): string {
  if (typeof v !== 'string') fail(`expected string at field ${field}`);
  return v;
}

export function requireNumber(v: unknown, field: string): number {
  if (typeof v !== 'number' || Number.isNaN(v)) fail(`expected number at field ${field}`);
  return v;
}

export function requireBoolean(v: unknown, field: string): boolean {
  if (typeof v !== 'boolean') fail(`expected boolean at field ${field}`);
  return v;
}

export function requireStringArray(v: unknown, field: string): string[] {
  if (!Array.isArray(v)) fail(`expected string[] at field ${field}`);
  const out: string[] = [];
  for (let i = 0; i < v.length; i++) {
    const item = v[i];
    if (typeof item !== 'string') fail(`expected string at field ${field}[${i}]`);
    out.push(item);
  }
  return out;
}
