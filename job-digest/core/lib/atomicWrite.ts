import { rename, rm, writeFile } from 'node:fs/promises';
import { err, ok, type Result } from '../types/result.js';

export interface IoError {
  readonly type: 'io';
  readonly path: string;
  readonly message: string;
}

const TMP_SUFFIX = '.tmp';

export async function atomicWriteFile(
  filePath: string,
  contents: string,
): Promise<Result<void, IoError>> {
  const tmp = `${filePath}${TMP_SUFFIX}.${process.pid}.${Date.now()}`;
  try {
    await writeFile(tmp, contents, { encoding: 'utf8', flag: 'w' });
    await rename(tmp, filePath);
    return ok(undefined);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'write failed';
    try {
      await rm(tmp, { force: true });
    } catch {
      // best-effort
    }
    return err({ type: 'io', path: filePath, message });
  }
}
