/** Run `worker` over `items` with at most `concurrency` in flight at once.
 * Workers pull from a shared cursor, so a slow item never blocks the others. */
export async function runPool<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  const lanes = Math.max(1, Math.min(Math.floor(concurrency), items.length));
  let cursor = 0;
  const runner = async (): Promise<void> => {
    for (;;) {
      const i = cursor;
      cursor += 1;
      if (i >= items.length) return;
      await worker(items[i] as T, i);
    }
  };
  await Promise.all(Array.from({ length: lanes }, runner));
}
