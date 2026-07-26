type Level = 'info' | 'debug' | 'warn' | 'error';

export function log(level: Level, msg: string, ctx: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...ctx });
  if (level === 'error' || level === 'warn') console.error(line);
  else console.log(line);
}
